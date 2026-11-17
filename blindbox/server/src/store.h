// store.h —— 存档（SQLite）
//
// 当前进度沿用 players（兼容 v4 已有数据库），只用最近更新的一行。
// 手动快照保存在独立 save_slots 表，没有当前进度时才自动新建。
// 不再使用 token、昵称和排行榜。
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "economy.h"

struct sqlite3;

namespace blindbox {

struct PlayerRow {
    std::string id;
    PlayerState state;
};

struct SaveSlot {
    int slot;
    std::string name;
    PlayerState state;
    nlohmann::json presentation;
    int64_t updatedAt;
    std::string revision;
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

    // 快照独立于自动保存的当前进度；0 是最近一次读档前的备份。
    std::vector<SaveSlot> listSlots();
    std::optional<SaveSlot> loadSlot(int slot);
    std::optional<SaveSlot> writeSlot(int slot, const std::string& name,
        const nlohmann::json& presentation, const Economy& economy,
        const std::string& expectedRevision);
    std::optional<SaveSlot> restoreSlot(int slot, const std::string& revision,
        const nlohmann::json& currentPresentation, const Economy& economy);
    bool deleteSlot(int slot, const std::string& revision);
    PlayerState resetProgress(const Economy& economy, const nlohmann::json& currentPresentation);

private:
    sqlite3* db_ = nullptr;
    void exec(const char* sql);
    void putSlot(int slot, const std::string& name, const PlayerState& state,
                 const nlohmann::json& presentation);
};

} // namespace blindbox
