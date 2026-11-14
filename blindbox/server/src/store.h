// store.h —— 存档（SQLite）
//
// 单机只有一份存档。表名沿用 players（兼容 v4 已有数据库），
// 只用最近更新的那一行；没有存档时自动新建。
// 不再使用 token、昵称和排行榜。
#pragma once
#include <string>

#include "economy.h"

struct sqlite3;

namespace blindbox {

struct PlayerRow {
    std::string id;
    PlayerState state;
};

class Store {
public:
    explicit Store(const std::string& dbPath); // 打不开会抛 std::runtime_error
    ~Store();
    Store(const Store&) = delete;
    Store& operator=(const Store&) = delete;

    // 读出现有存档；没有则用 economy.newPlayer() 建一份
    PlayerRow loadOrCreate(const Economy& economy);
    void saveState(const std::string& id, const PlayerState& s);

private:
    sqlite3* db_ = nullptr;
    void exec(const char* sql);
};

} // namespace blindbox
