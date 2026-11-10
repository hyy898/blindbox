// store.cpp —— SQLite 存档实现（全部使用预编译语句 + 参数绑定，防 SQL 注入）
#include "store.h"

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
    void bindNull(int i) { sqlite3_bind_null(st, i); }
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
    int integer(int col) { return sqlite3_column_int(st, col); }
};
} // namespace

Store::Store(const std::string& dbPath) {
    if (sqlite3_open(dbPath.c_str(), &db_) != SQLITE_OK) {
        std::string msg = db_ ? sqlite3_errmsg(db_) : "unknown";
        sqlite3_close(db_);
        throw std::runtime_error("打不开存档数据库 " + dbPath + ": " + msg);
    }
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

void Store::createPlayer(const PlayerRow& row) {
    Stmt st(db_,
            "INSERT INTO players(id, token, nickname, state, best_value, fastest_win, "
            "created_at, updated_at) VALUES(?,?,?,?,0,NULL,?,?)");
    int now = (int)std::time(nullptr);
    st.bind(1, row.id);
    st.bind(2, row.token);
    st.bind(3, row.nickname);
    st.bind(4, stateToJson(row.state).dump());
    st.bind(5, now);
    st.bind(6, now);
    st.step();
}

std::optional<PlayerRow> Store::findByToken(const std::string& token) {
    Stmt st(db_, "SELECT id, token, nickname, state FROM players WHERE token = ?");
    st.bind(1, token);
    if (!st.step()) return std::nullopt;
    PlayerRow row;
    row.id = st.text(0);
    row.token = st.text(1);
    row.nickname = st.text(2);
    row.state = stateFromJson(nlohmann::json::parse(st.text(3)));
    return row;
}

void Store::saveState(const std::string& id, const PlayerState& s) {
    Stmt st(db_,
            "UPDATE players SET state = ?, best_value = ?, fastest_win = ?, updated_at = ? "
            "WHERE id = ?");
    st.bind(1, stateToJson(s).dump());
    st.bind(2, s.bestShowcaseValue);
    if (s.fastestWinBoxes) st.bind(3, *s.fastestWinBoxes);
    else st.bindNull(3);
    st.bind(4, (int)std::time(nullptr));
    st.bind(5, id);
    st.step();
}

std::vector<RecordRow> Store::topShowcaseValue(int limit) {
    Stmt st(db_,
            "SELECT id, nickname, best_value FROM players WHERE best_value > 0 "
            "ORDER BY best_value DESC, updated_at ASC LIMIT ?");
    st.bind(1, limit);
    std::vector<RecordRow> out;
    while (st.step()) out.push_back({st.text(0), st.text(1), st.integer(2)});
    return out;
}

std::vector<RecordRow> Store::fastestWins(int limit) {
    Stmt st(db_,
            "SELECT id, nickname, fastest_win FROM players WHERE fastest_win IS NOT NULL "
            "ORDER BY fastest_win ASC, updated_at ASC LIMIT ?");
    st.bind(1, limit);
    std::vector<RecordRow> out;
    while (st.step()) out.push_back({st.text(0), st.text(1), st.integer(2)});
    return out;
}

int Store::playerCount() {
    Stmt st(db_, "SELECT COUNT(*) FROM players");
    return st.step() ? st.integer(0) : 0;
}

} // namespace blindbox
