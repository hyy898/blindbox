// store.cpp —— SQLite 存档实现（全部使用预编译语句 + 参数绑定，防 SQL 注入）
#include "store.h"

#include <chrono>
#include <ctime>
#include <stdexcept>

#include "sqlite3.h"

namespace blindbox {

namespace {
// 小工具：RAII 管理 sqlite3_stmt，离开作用域自动 finalize
struct Stmt {
    sqlite3_stmt* st = nullptr;
    Stmt(sqlite3* db, const char* sql) {
        if (sqlite3_prepare_v2(db, sql, -1, &st, nullptr) != SQLITE_OK)
            throw std::runtime_error(std::string("SQL 准备失败: ") + sqlite3_errmsg(db));
    }
    ~Stmt() { sqlite3_finalize(st); }
    void bind(int i, const std::string& v) {
        sqlite3_bind_text(st, i, v.c_str(), (int)v.size(), SQLITE_TRANSIENT);
    }
    void bind(int i, int v) { sqlite3_bind_int(st, i, v); }
    void bind(int i, int64_t v) { sqlite3_bind_int64(st, i, v); }
    bool step() { // 有一行返回 true；结束返回 false
        int rc = sqlite3_step(st);
        if (rc == SQLITE_ROW) return true;
        if (rc == SQLITE_DONE) return false;
        throw std::runtime_error(std::string("SQL 执行失败: ") +
                                 sqlite3_errmsg(sqlite3_db_handle(st)));
    }
    std::string text(int col) {
        auto p = sqlite3_column_text(st, col);
        return p ? reinterpret_cast<const char*>(p) : "";
    }
    int64_t integer(int col) { return sqlite3_column_int64(st, col); }
};

SaveSlot slotFromRow(Stmt& st) {
    return {int(st.integer(0)), st.text(1),
        stateFromJson(nlohmann::json::parse(st.text(2))),
        nlohmann::json::parse(st.text(3)), st.integer(4), st.text(5)};
}

struct Transaction {
    sqlite3* db;
    bool committed = false;
    explicit Transaction(sqlite3* value) : db(value) {
        if (sqlite3_exec(db, "BEGIN IMMEDIATE", nullptr, nullptr, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
    }
    ~Transaction() {
        if (!committed) sqlite3_exec(db, "ROLLBACK", nullptr, nullptr, nullptr);
    }
    void commit() {
        if (sqlite3_exec(db, "COMMIT", nullptr, nullptr, nullptr) != SQLITE_OK)
            throw std::runtime_error(sqlite3_errmsg(db));
        committed = true;
    }
};
} // namespace

Store::Store(const std::string& dbPath) {
    if (sqlite3_open(dbPath.c_str(), &db_) != SQLITE_OK) {
        std::string msg = db_ ? sqlite3_errmsg(db_) : "unknown";
        sqlite3_close(db_);
        throw std::runtime_error("打不开存档数据库 " + dbPath + ": " + msg);
    }
    sqlite3_busy_timeout(db_, 5000);
    exec("PRAGMA journal_mode=WAL;");   // 写入更稳，崩溃不容易坏档
    exec("PRAGMA synchronous=NORMAL;");
    exec(R"SQL(
        CREATE TABLE IF NOT EXISTS players (
            id          TEXT PRIMARY KEY,
            token       TEXT NOT NULL UNIQUE,
            nickname    TEXT NOT NULL,
            state       TEXT NOT NULL,
            best_value  INTEGER NOT NULL DEFAULT 0,
            fastest_win INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS save_slots (
            slot         INTEGER PRIMARY KEY CHECK(slot BETWEEN 0 AND 3),
            name         TEXT NOT NULL,
            state        TEXT NOT NULL,
            presentation TEXT NOT NULL,
            updated_at   INTEGER NOT NULL,
            revision     TEXT NOT NULL
        );
    )SQL");
}

Store::~Store() { sqlite3_close(db_); }

void Store::exec(const char* sql) {
    char* err = nullptr;
    if (sqlite3_exec(db_, sql, nullptr, nullptr, &err) != SQLITE_OK) {
        std::string msg = err ? err : "unknown";
        sqlite3_free(err);
        throw std::runtime_error("SQL 失败: " + msg);
    }
}

PlayerRow Store::loadOrCreate(const Economy& economy) {
    {
        Stmt st(db_, "SELECT id, state FROM players ORDER BY updated_at DESC, created_at DESC LIMIT 1");
        if (st.step()) {
            PlayerRow row;
            row.id = st.text(0);
            row.state = stateFromJson(nlohmann::json::parse(st.text(1)));
            return row;
        }
    }
    PlayerRow row;
    row.id = "local";
    row.state = economy.newPlayer();
    int now = (int)std::time(nullptr);
    Stmt ins(db_,
             "INSERT INTO players(id, token, nickname, state, best_value, fastest_win, "
             "created_at, updated_at) VALUES(?,?,?,?,0,NULL,?,?)");
    ins.bind(1, row.id);
    ins.bind(2, "local");
    ins.bind(3, "");
    ins.bind(4, stateToJson(row.state).dump());
    ins.bind(5, now);
    ins.bind(6, now);
    ins.step();
    return row;
}

void Store::saveState(const std::string& id, const PlayerState& s) {
    Stmt st(db_,
            "UPDATE players SET state = ?, updated_at = ? WHERE id = ?");
    st.bind(1, stateToJson(s).dump());
    st.bind(2, (int)std::time(nullptr));
    st.bind(3, id);
    st.step();
}

std::vector<SaveSlot> Store::listSlots() {
    Stmt st(db_, "SELECT slot,name,state,presentation,updated_at,revision FROM save_slots ORDER BY slot");
    std::vector<SaveSlot> result;
    while (st.step()) result.push_back(slotFromRow(st));
    return result;
}

std::optional<SaveSlot> Store::loadSlot(int slot) {
    Stmt st(db_, "SELECT slot,name,state,presentation,updated_at,revision FROM save_slots WHERE slot=?");
    st.bind(1, slot);
    if (st.step()) return slotFromRow(st);
    return std::nullopt;
}

void Store::putSlot(int slot, const std::string& name, const PlayerState& state,
                    const nlohmann::json& presentation) {
    Stmt st(db_, R"SQL(
        INSERT INTO save_slots(slot,name,state,presentation,updated_at,revision)
        VALUES(?,?,?,?,?,lower(hex(randomblob(16))))
        ON CONFLICT(slot) DO UPDATE SET name=excluded.name,state=excluded.state,
            presentation=excluded.presentation,updated_at=excluded.updated_at,revision=excluded.revision
    )SQL");
    st.bind(1, slot);
    st.bind(2, name);
    st.bind(3, stateToJson(state).dump());
    st.bind(4, presentation.dump());
    st.bind(5, int64_t(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count()));
    st.step();
}

std::optional<SaveSlot> Store::writeSlot(int slot, const std::string& name,
    const nlohmann::json& presentation, const Economy& economy, const std::string& expectedRevision) {
    Transaction transaction(db_);
    auto previous = loadSlot(slot);
    if ((previous ? previous->revision : "") != expectedRevision) return std::nullopt;
    auto player = loadOrCreate(economy);
    putSlot(slot, name, player.state, presentation);
    auto result = loadSlot(slot);
    transaction.commit();
    return result;
}

std::optional<SaveSlot> Store::restoreSlot(int slot, const std::string& revision,
    const nlohmann::json& currentPresentation, const Economy& economy) {
    Transaction transaction(db_);
    auto target = loadSlot(slot);
    if (!target || target->revision != revision) return std::nullopt;
    auto player = loadOrCreate(economy);
    // 目标先读进内存，恢复 0 号备份时也可以安全交换两份进度。
    putSlot(0, "读档前的进度", player.state, currentPresentation);
    saveState(player.id, target->state);
    transaction.commit();
    return target;
}

bool Store::deleteSlot(int slot, const std::string& revision) {
    Transaction transaction(db_);
    auto target = loadSlot(slot);
    if (!target || target->revision != revision) return false;
    Stmt st(db_, "DELETE FROM save_slots WHERE slot=? AND revision=?");
    st.bind(1, slot);
    st.bind(2, revision);
    st.step();
    transaction.commit();
    return true;
}

PlayerState Store::resetProgress(const Economy& economy, const nlohmann::json& currentPresentation) {
    Transaction transaction(db_);
    auto player = loadOrCreate(economy);
    putSlot(0, "重新开局前的进度", player.state, currentPresentation);
    auto fresh = economy.newPlayer();
    saveState(player.id, fresh);
    transaction.commit();
    return fresh;
}

} // namespace blindbox
