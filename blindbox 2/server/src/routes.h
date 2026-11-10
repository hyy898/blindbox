// routes.h —— HTTP 接口（把网络请求翻译成 Economy 的调用，再把结果存进 Store）
#pragma once
#include <mutex>
#include <string>

#include "config.h"
#include "economy.h"
#include "store.h"

namespace httplib { class Server; }

namespace blindbox {

struct AppContext {
    const GameConfig& cfg;
    Economy& economy;
    Store& store;
    // 全局一把锁：同一时间只处理一个"读档-改档-存档"。
    // 本机单人游戏完全够用，逻辑也最简单，不会出现并发改坏存档。
    std::mutex mu;
    std::string version = "4.0.0";
};

// 注册所有 /api/* 路由和 CORS
void registerRoutes(httplib::Server& srv, AppContext& app);

} // namespace blindbox
