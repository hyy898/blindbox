// economy.h —— 游戏规则（服务器说了算）
//
// 这里是整个后端最核心的部分：开盒抽取、保底、防重复、卖出、展柜、
// 集齐奖励与解锁、破产补助。规则和前端单机版 src/game.js 一一对应，
// 只是挪到服务器上算，玩家改本地数据没法作弊。
//
// 这一层不碰网络也不碰数据库：输入一个 PlayerState，修改它，返回结果。
// 这样单独测试、单独阅读都很方便。
#pragma once
#include <map>
#include <optional>
#include <random>
#include <set>
#include <string>
#include <vector>

#include "config.h"
#include "json.hpp"

namespace blindbox {

// 一个"实物"手办（开出来的每一个都有唯一 uid，同款可以有多个）
struct Entry {
    std::string uid;       // "u17"
    std::string itemId;    // "ms-03"
    std::string seriesId;  // "midnight-snack"
    std::string rarity;    // "common"
    bool forcedByPity = false; // 这一抽是不是保底触发的
    bool preferredNew = false; // 是否由"防重复"规则选中的新款
};

// 一个玩家的完整存档。字段名和前端 game.js 的 state 保持一致，
// 这样前端拿到 JSON 可以直接渲染。
struct PlayerState {
    int coins = 0;
    std::map<std::string, bool> unlocked;        // 系列是否解锁
    std::map<std::string, int> pity;             // 系列 -> 连续没出隐藏款的次数
    std::map<std::string, std::set<std::string>> showcase; // 系列 -> 展柜里的手办 id
    std::vector<Entry> storage;                  // 仓库
    std::set<std::string> everOwned;             // 开出过一次就算（卖掉也算）
    std::set<std::string> rewarded;              // 已领过集齐奖励的系列
    int boxesOpened = 0;
    int bailoutCount = 0;
    std::optional<Entry> pending;                // 正在展示界面里、还没决定去向的手办
    bool won = false;
    int uidSeq = 1;                              // 下一个 uid 序号

    // ---- 本机个人记录 ----
    int bestShowcaseValue = 0;                   // 展柜最高总价值（按系统卖价）
    std::optional<int> fastestWinBoxes;          // 最快全部通关用了几个盒子
};

nlohmann::json stateToJson(const PlayerState& s);
PlayerState stateFromJson(const nlohmann::json& j);
nlohmann::json entryToJson(const Entry& e);

// 每个操作的结果：成功时 data 里放返回给前端的内容；
// 失败时 error 是机器可读的错误码，message 是中文说明。
struct ActionResult {
    bool ok = false;
    int httpStatus = 200;
    std::string error;
    std::string message;
    nlohmann::json data = nlohmann::json::object();

    static ActionResult success(nlohmann::json d = nlohmann::json::object()) {
        ActionResult r;
        r.ok = true;
        r.data = std::move(d);
        return r;
    }
    static ActionResult fail(int status, std::string code, std::string msg) {
        ActionResult r;
        r.httpStatus = status;
        r.error = std::move(code);
        r.message = std::move(msg);
        return r;
    }
};

class Economy {
public:
    // seed = 0 表示用真随机；测试时传固定种子，结果可复现
    Economy(const GameConfig& cfg, uint64_t seed);

    PlayerState newPlayer() const;

    // ===== 玩家操作（全部会做合法性检查）=====
    ActionResult open(PlayerState& s, const std::string& seriesId);           // 买盒 + 开盒
    ActionResult pendingToShowcase(PlayerState& s);                           // 展示中的手办 -> 展柜
    ActionResult pendingToStorage(PlayerState& s);                            // 展示中的手办 -> 仓库
    ActionResult reopenFromStorage(PlayerState& s, const std::string& uid);   // 仓库 -> 再次展示
    ActionResult sellPending(PlayerState& s);
    ActionResult sellFromStorage(PlayerState& s, const std::string& uid);
    ActionResult sellFromShowcase(PlayerState& s, const std::string& seriesId,
                                  const std::string& itemId);
    ActionResult bailout(PlayerState& s);                                     // 主动申请破产补助

    // ===== 查询 =====
    bool isSeriesComplete(const PlayerState& s, const std::string& seriesId) const;
    bool hasSellable(const PlayerState& s) const;
    bool bailoutEligible(const PlayerState& s) const;
    int showcaseValue(const PlayerState& s) const;

    const GameConfig& config() const { return cfg_; }

private:
    const GameConfig& cfg_;
    std::mt19937_64 rng_;

    double rand01();                                   // [0,1)
    size_t randIndex(size_t n);                        // [0,n)
    std::string rollRarity(bool forceSecret);
    const Item* pickWeighted(const std::vector<const Item*>& pool);
    int applyBailoutIfEligible(PlayerState& s);        // 返回发放的金币（0 = 没发）
    nlohmann::json checkComplete(PlayerState& s, const std::string& seriesId);
    void updateRecords(PlayerState& s) const;
};

} // namespace blindbox
