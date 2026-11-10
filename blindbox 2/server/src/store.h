// store.h —— 存档（SQLite）
//
// 一张表 players：每个玩家一行，存档整体以 JSON 文本保存在 state 列。
// 另外把两项"个人记录"单独存成列，方便排序出排行榜。
//
//   id          玩家 id（公开，出现在排行榜）
//   token       登录凭证（只有玩家自己知道，每个请求都要带）
//   nickname    昵称
//   state       存档 JSON（见 economy.cpp 的 stateToJson）
//   best_value  展柜最高总价值
//   fastest_win 最快全部通关的开盒数（没通关为 NULL）
#pragma once
#include <optional>
#include <string>
#include <vector>

#include "economy.h"

struct sqlite3;

namespace blindbox {

struct PlayerRow {
    std::string id;
    std::string token;
    std::string nickname;
    PlayerState state;
};

struct RecordRow {
    std::string id;
    std::string nickname;
    int value = 0;
};

class Store {
public:
    explicit Store(const std::string& dbPath); // 打不开会抛 std::runtime_error
    ~Store();
    Store(const Store&) = delete;
    Store& operator=(const Store&) = delete;

    void createPlayer(const PlayerRow& row);
    std::optional<PlayerRow> findByToken(const std::string& token);
    void saveState(const std::string& id, const PlayerState& s);

    // 排行榜：展柜最高总价值（降序） / 最快通关（升序）
    std::vector<RecordRow> topShowcaseValue(int limit);
    std::vector<RecordRow> fastestWins(int limit);
    int playerCount();

private:
    sqlite3* db_ = nullptr;
    void exec(const char* sql);
};

} // namespace blindbox
