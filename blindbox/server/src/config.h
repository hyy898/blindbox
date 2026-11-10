// config.h —— 游戏配置的数据结构（只有"长什么样"，具体数值在 game_config.cpp）
//
// ┌──────────────────────────────────────────────────────────────┐
// │  老板改数值：只改 game_config.cpp，然后重新编译（双击 编译.bat）  │
// └──────────────────────────────────────────────────────────────┘
//
// 服务器启动时会调用 validateConfig() 检查配置（概率加起来是否为 1、
// id 是否重复等），有问题会打印中文错误并退出，不会带着错配置运行。
// 前端通过 GET /api/config 拿到同一份配置来画商店、展柜和手办，
// 所以 JS 里没有写死任何手办列表。
#pragma once
#include <map>
#include <string>
#include <vector>

#include "json.hpp"

namespace blindbox {

// 稀有度：例如 普通 / 稀有 / 史诗 / 隐藏款
struct Rarity {
    std::string key;       // 程序里用的英文 key，例如 "common"
    std::string label;     // 界面显示的中文名，例如 "普通"
    double dropRate = 0;   // 开盒时抽中这个稀有度的概率（所有稀有度加起来必须 = 1）
    int sellPrice = 0;     // 默认卖给系统的价格（单个手办可以单独覆盖）
    std::string color;     // 界面颜色，例如 "#9aa0a6"
};

// 手办（盲盒里开出来的东西）
struct Item {
    std::string id;        // 唯一 id，例如 "ms-01"（全局不能重复）
    std::string name;      // 中文名
    std::string rarity;    // 稀有度 key
    std::string desc;      // 一句话描述（也是给 Lux3D 生成模型的提示词参考）
    int sellPrice = 0;     // 0 = 用稀有度的默认卖价；>0 = 这个手办单独定价
    double weight = 1.0;   // 同一盒子、同一稀有度里的相对权重（默认都一样 = 等概率）
    std::string model;     // 模型文件名（放在 models/ 下）；空 = 自动用 "<id>.glb"
};

// 盲盒种类（一个"系列"就是一种盒子）
struct Series {
    std::string id;              // 唯一 id，例如 "midnight-snack"
    std::string name;            // 中文名，例如 "深夜食堂"
    int boxPrice = 0;            // 这种盒子多少钱；0 = 用 Economy.defaultBoxPrice
    bool unlockedAtStart = false;// 开局是否就能买
    std::string unlockCondition; // 未解锁时显示的提示文字
    int completeReward = 0;      // 第一次集齐（7 个都放进展柜）的奖励金币
    std::vector<Item> items;
};

// 经济数值
struct EconomyConfig {
    int startCoins = 500;          // 开局金币
    int defaultBoxPrice = 100;     // 盒子默认价格
    int pityAfter = 12;            // 保底：连续 N 个没出隐藏款，第 N 个必出
    std::string pityRarity = "secret"; // 保底给的稀有度
    int bailoutCoins = 200;        // 破产补助
    bool noDupeUntilOwned = true;  // 防重复：同稀有度里优先开出从没拥有过的
};

struct GameConfig {
    int version = 1;
    EconomyConfig economy;
    std::vector<Rarity> rarities;  // 顺序有意义：抽稀有度时按这个顺序累减概率
    std::vector<Series> series;    // 顺序 = 解锁顺序（集齐上一个解锁下一个）

    std::map<std::string, Item> itemsById; // 索引，由 finalize() 生成

    // ---- 查询小工具 ----
    const Rarity* rarity(const std::string& key) const;
    const Series* findSeries(const std::string& id) const;
    const Item* findItem(const std::string& id) const;
    int sellPriceOf(const std::string& itemId) const; // 未知 id 返回 0
    int boxPriceOf(const std::string& seriesId) const;
    std::string modelFileOf(const Item& item) const;   // "ms-01.glb"
};

// 在 game_config.cpp 里实现：返回老板写好的配置
GameConfig buildGameConfig();

// 生成派生字段（id -> 手办 索引）。buildGameConfig 之后调用一次
void finalizeConfig(GameConfig& cfg);

// 检查配置，返回所有问题（中文）。空 = 没问题
std::vector<std::string> validateConfig(const GameConfig& cfg);

// 转成前端用的 JSON（和旧 items.json 同样的格式，外加 boxPrice/model 等字段）。
// 用 ordered_json 保持字段顺序（稀有度顺序会影响抽取，前后端要一致）
nlohmann::ordered_json configToJson(const GameConfig& cfg);

} // namespace blindbox
