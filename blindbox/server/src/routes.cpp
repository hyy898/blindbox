// routes.cpp —— 全部 HTTP 接口
//
// 约定（详见 docs/api.md）：
//   · 请求和响应都是 JSON（UTF-8）
//   · 单机只有一份存档，接口不需要登录或 token；第一次访问时自动建档
//   · 成功： { "ok": true, ...数据..., "state": {...最新存档...}, "progress": {...} }
//   · 失败： { "ok": false, "error": "错误码", "message": "中文说明" }，HTTP 状态码 4xx
//   · 所有规则都在服务器上判断，前端只负责显示
#include "routes.h"

#include <cmath>
#include "httplib.h"

namespace blindbox {

using nlohmann::json;

namespace {

// ---------- 小工具 ----------

void sendJson(httplib::Response& res, int status, const json& body) {
    res.status = status;
    res.set_header("Cache-Control", "no-store");
    res.set_content(body.dump(), "application/json; charset=utf-8");
}

void sendError(httplib::Response& res, int status, const std::string& code,
               const std::string& message) {
    sendJson(res, status, {{"ok", false}, {"error", code}, {"message", message}});
}

// 解析请求体为 JSON 对象。空 body 视为 {}。失败返回 false 并已写好错误响应
bool parseBody(const httplib::Request& req, httplib::Response& res, json& out) {
    if (req.body.empty()) {
        out = json::object();
        return true;
    }
    out = json::parse(req.body, nullptr, /*allow_exceptions=*/false);
    if (out.is_discarded() || !out.is_object()) {
        sendError(res, 400, "bad_json", "请求体必须是 JSON 对象");
        return false;
    }
    return true;
}

// 从 JSON 里取一个必填的短字符串字段
bool requireString(const json& body, const char* key, httplib::Response& res,
                   std::string& out, size_t maxLen = 64) {
    auto it = body.find(key);
    if (it == body.end() || !it->is_string() || it->get<std::string>().empty() ||
        it->get<std::string>().size() > maxLen) {
        sendError(res, 400, "bad_param", std::string("缺少参数或格式不对: ") + key);
        return false;
    }
    out = it->get<std::string>();
    return true;
}

bool saveParameters(const json& body, httplib::Response& res, int& slot,
                    std::string& revision, bool manualOnly = false) {
    if (!body.contains("slot") || !body["slot"].is_number_integer() ||
        body["slot"] < (manualOnly ? 1 : 0) || body["slot"] > 3 ||
        !body.contains("revision") || !body["revision"].is_string() ||
        body["revision"].get<std::string>().size() > 64) {
        sendError(res, 400, "bad_param", "存档位置或版本格式不正确。");
        return false;
    }
    slot = body["slot"].get<int>();
    revision = body["revision"].get<std::string>();
    return true;
}

bool readPresentation(const json& body, httplib::Response& res, const GameConfig& cfg, json& out) {
    out = {{"layout", json::array({nullptr, nullptr, nullptr})},
           {"preferences", {{"muted", true}, {"reduced", false}}}};
    if (!body.contains("presentation")) return true;
    const auto& view = body["presentation"];
    auto invalid = [&] {
        sendError(res, 400, "bad_param", "展柜与偏好设置格式不正确。");
        return false;
    };
    if (!view.is_object()) return invalid();
    if (view.contains("layout")) {
        const auto& layout = view["layout"];
        if (!layout.is_array() || layout.size() != 3) return invalid();
        for (size_t i = 0; i < layout.size(); ++i) {
            const auto& item = layout[i];
            if (item.is_null()) continue;
            if (!item.is_object() || !item.contains("itemId") || !item["itemId"].is_string() ||
                !cfg.findItem(item["itemId"].get<std::string>()) ||
                !item.contains("rotation") || !item["rotation"].is_number()) return invalid();
            double rotation = item["rotation"].get<double>();
            if (!std::isfinite(rotation) || rotation < -180 || rotation > 180) return invalid();
            out["layout"][i] = {{"itemId", item["itemId"]}, {"rotation", rotation}};
        }
    }
    if (view.contains("preferences")) {
        if (!view["preferences"].is_object()) return invalid();
        for (const char* key : {"muted", "reduced"}) {
            if (!view["preferences"].contains(key) || !view["preferences"][key].is_boolean()) return invalid();
            out["preferences"][key] = view["preferences"][key];
        }
    }
    return true;
}

bool compatibleSave(const SaveSlot& save, const GameConfig& cfg) {
    auto valid = [&](const std::string& sid, const std::string& iid) {
        auto it = cfg.seriesOfItem.find(iid);
        return it != cfg.seriesOfItem.end() && it->second == sid;
    };
    for (const auto& [sid, ids] : save.state.showcase) {
        if (!cfg.findSeries(sid)) return false;
        for (const auto& iid : ids) if (!valid(sid, iid)) return false;
    }
    for (const auto& entry : save.state.storage) if (!valid(entry.seriesId, entry.itemId)) return false;
    if (save.state.pending && !valid(save.state.pending->seriesId, save.state.pending->itemId)) return false;
    for (const auto& iid : save.state.everOwned) if (!cfg.findItem(iid)) return false;
    return true;
}

json saveJson(const SaveSlot& save, bool includeState = false) {
    std::set<std::string> unique;
    size_t count = save.state.storage.size() + (save.state.pending ? 1 : 0);
    for (const auto& entry : save.state.storage) unique.insert(entry.itemId);
    if (save.state.pending) unique.insert(save.state.pending->itemId);
    for (const auto& [sid, ids] : save.state.showcase) {
        count += ids.size();
        unique.insert(ids.begin(), ids.end());
    }
    json result = {{"slot", save.slot}, {"name", save.name}, {"updatedAt", save.updatedAt},
        {"revision", save.revision}, {"coins", save.state.coins}, {"boxesOpened", save.state.boxesOpened},
        {"collectionCount", count}, {"uniqueCount", unique.size()}, {"hasPending", save.state.pending.has_value()}};
    if (includeState) {
        result["state"] = stateToJson(save.state);
        result["presentation"] = save.presentation;
    }
    return result;
}

// ---------- 读档 → 执行操作 → 成功就存档 → 回复 ----------
//
// 单机只有一份存档，不需要 token。action 返回 ActionResult；
// 失败的话存档不会被保存（等于什么都没发生）
template <typename Fn>
void withSave(AppContext& app, httplib::Response& res, Fn action) {
    std::lock_guard<std::mutex> lock(app.mu);
    PlayerRow row = app.store.loadOrCreate(app.economy);
    ActionResult r = action(row);
    if (!r.ok) {
        sendError(res, r.httpStatus, r.error, r.message);
        return;
    }
    app.store.saveState(row.id, row.state);
    json body = r.data;
    body["ok"] = true;
    body["state"] = stateToJson(row.state);
    body["progress"] = app.economy.progressJson(row.state); // 收集进度 x/21
    sendJson(res, 200, body);
}

} // namespace

void registerRoutes(httplib::Server& srv, AppContext& app) {
    // ---------------- CORS ----------------
    // 开发时允许用 ?server= 从另一个端口的网页调用本接口。
    srv.set_default_headers({
        {"Access-Control-Allow-Origin", "*"},
        {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
        {"Access-Control-Allow-Headers", "Content-Type"},
        {"Access-Control-Max-Age", "86400"},
        {"Access-Control-Expose-Headers", "X-Blindbox-Server"},
        // 前端靠这个响应头判断"网页是不是由 blindbox-server 提供的"
        {"X-Blindbox-Server", app.version},
    });
    srv.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    // ---------------- 公开接口 ----------------

    // 健康检查：启动器/测试用来确认服务器在运行
    srv.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {
        sendJson(res, 200, {{"ok", true}, {"name", "blindbox-server"},
                            {"version", app.version}});
    });

    // 游戏配置（来自 game_config.cpp）。前端用它画商店、展柜和手办
    auto sendConfig = [&](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", "no-store");
        res.set_content(configToJson(app.cfg).dump(), "application/json; charset=utf-8");
    };
    srv.Get("/api/config", sendConfig);

    // ---------------- 存档接口（自动使用本机唯一存档） ----------------

    // 读取存档（没有则自动新建）
    srv.Get("/api/state", [&](const httplib::Request&, httplib::Response& res) {
        withSave(app, res, [&](PlayerRow&) { return ActionResult::success(); });
    });

    // 三个手动存档位，以及最近一次读档前的自动备份（0）。
    srv.Get("/api/saves", [&](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(app.mu);
        json saves = json::array();
        for (const auto& save : app.store.listSlots()) saves.push_back(saveJson(save));
        sendJson(res, 200, {{"ok", true}, {"saves", saves}});
    });
    srv.Get(R"(/api/saves/([0-3]))", [&](const httplib::Request& req, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(app.mu);
        auto save = app.store.loadSlot(std::stoi(req.matches[1].str()));
        if (!save) { sendError(res, 404, "save_not_found", "这个位置还没有存档。"); return; }
        sendJson(res, 200, {{"ok", true}, {"save", saveJson(*save, true)}});
    });
    srv.Post("/api/saves/save", [&](const httplib::Request& req, httplib::Response& res) {
        json body, presentation;
        int slot;
        std::string revision, name;
        if (!parseBody(req, res, body) || !saveParameters(body, res, slot, revision, true) ||
            !requireString(body, "name", res, name, 96) ||
            !readPresentation(body, res, app.cfg, presentation)) return;
        std::lock_guard<std::mutex> lock(app.mu);
        auto save = app.store.writeSlot(slot, name, presentation, app.economy, revision);
        if (!save) { sendError(res, 409, "save_changed", "这个存档已在其他页面修改，请重新查看后操作。"); return; }
        sendJson(res, 200, {{"ok", true}, {"save", saveJson(*save)},
            {"state", stateToJson(save->state)}, {"progress", app.economy.progressJson(save->state)}});
    });
    srv.Post("/api/saves/load", [&](const httplib::Request& req, httplib::Response& res) {
        json body, presentation;
        int slot;
        std::string revision;
        if (!parseBody(req, res, body) || !saveParameters(body, res, slot, revision) ||
            !readPresentation(body, res, app.cfg, presentation)) return;
        std::lock_guard<std::mutex> lock(app.mu);
        auto target = app.store.loadSlot(slot);
        if (!target) { sendError(res, 404, "save_not_found", "这个存档已删除，请选择其他存档。"); return; }
        if (!compatibleSave(*target, app.cfg)) {
            sendError(res, 409, "save_incompatible", "存档中有当前配置已移除的藏品，请恢复对应配置后再读档。");
            return;
        }
        auto save = app.store.restoreSlot(slot, revision, presentation, app.economy);
        if (!save) { sendError(res, 409, "save_changed", "这个存档已在其他页面修改，请重新查看后操作。"); return; }
        sendJson(res, 200, {{"ok", true}, {"loadedSlot", slot}, {"presentation", save->presentation},
            {"state", stateToJson(save->state)}, {"progress", app.economy.progressJson(save->state)}});
    });
    srv.Post("/api/saves/delete", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        int slot;
        std::string revision;
        if (!parseBody(req, res, body) || !saveParameters(body, res, slot, revision)) return;
        std::lock_guard<std::mutex> lock(app.mu);
        if (!app.store.deleteSlot(slot, revision)) {
            sendError(res, 409, "save_changed", "这个存档已删除或更新，请重新查看后操作。");
            return;
        }
        auto player = app.store.loadOrCreate(app.economy);
        sendJson(res, 200, {{"ok", true}, {"deletedSlot", slot},
            {"state", stateToJson(player.state)}, {"progress", app.economy.progressJson(player.state)}});
    });

    // 开盒：{ "seriesId": "midnight-snack" }
    srv.Post("/api/open", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string seriesId;
        if (!parseBody(req, res, body) || !requireString(body, "seriesId", res, seriesId)) return;
        withSave(app, res, [&](PlayerRow& p) { return app.economy.open(p.state, seriesId); });
    });

    // 展示中的手办 → 展柜（展柜已有同款会被拒绝：already_in_showcase）
    srv.Post("/api/showcase", [&](const httplib::Request&, httplib::Response& res) {
        withSave(app, res,
                 [&](PlayerRow& p) { return app.economy.pendingToShowcase(p.state); });
    });

    // 展示中的手办 → 仓库（点空白处关闭展示界面）
    srv.Post("/api/storage", [&](const httplib::Request&, httplib::Response& res) {
        withSave(app, res,
                 [&](PlayerRow& p) { return app.economy.pendingToStorage(p.state); });
    });

    // 仓库里的手办重新打开展示界面：{ "uid": "u3" }
    srv.Post("/api/reopen", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string uid;
        if (!parseBody(req, res, body) || !requireString(body, "uid", res, uid)) return;
        withSave(app, res,
                 [&](PlayerRow& p) { return app.economy.reopenFromStorage(p.state, uid); });
    });

    // 展柜里的手办 → 仓库：{ "seriesId": "...", "itemId": "..." }
    // （展柜里的不能直接卖，想卖得先取回仓库）
    srv.Post("/api/unshowcase", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string sid, iid;
        if (!parseBody(req, res, body) || !requireString(body, "seriesId", res, sid) ||
            !requireString(body, "itemId", res, iid))
            return;
        withSave(app, res,
                 [&](PlayerRow& p) { return app.economy.showcaseToStorage(p.state, sid, iid); });
    });

    // 卖给系统（只有展示中的和仓库里的能卖）：
    //   { "from": "pending" }                卖展示中的
    //   { "from": "storage", "uid": "u3" }   卖仓库里的
    srv.Post("/api/sell", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string from;
        if (!parseBody(req, res, body) || !requireString(body, "from", res, from)) return;
        if (from == "pending") {
            withSave(app, res, [&](PlayerRow& p) { return app.economy.sellPending(p.state); });
        } else if (from == "storage") {
            std::string uid;
            if (!requireString(body, "uid", res, uid)) return;
            withSave(app, res,
                     [&](PlayerRow& p) { return app.economy.sellFromStorage(p.state, uid); });
        } else {
            sendError(res, 400, "bad_param",
                      "from 只能是 pending 或 storage（展柜里的手办不能卖，先取回仓库）");
        }
    });

    // 申请破产补助（条件不满足会被拒绝）
    srv.Post("/api/bailout", [&](const httplib::Request&, httplib::Response& res) {
        withSave(app, res, [&](PlayerRow& p) { return app.economy.bailout(p.state); });
    });

    // 新开局：原子备份当前进度，保留所有手动存档位。
    auto newGame = [&](const httplib::Request& req, httplib::Response& res) {
        json body, presentation;
        if (!parseBody(req, res, body) || !readPresentation(body, res, app.cfg, presentation)) return;
        std::lock_guard<std::mutex> lock(app.mu);
        auto state = app.store.resetProgress(app.economy, presentation);
        presentation["layout"] = json::array({nullptr, nullptr, nullptr});
        sendJson(res, 200, {{"ok", true}, {"reset", true}, {"presentation", presentation},
            {"state", stateToJson(state)}, {"progress", app.economy.progressJson(state)}});
    };
    srv.Post("/api/saves/new", newGame);
    srv.Post("/api/reset", newGame); // 兼容旧接口；新前端使用专用路径以识别旧服务。

    // ---------------- 其他 /api 路径一律 404 ----------------
    srv.set_error_handler([](const httplib::Request& req, httplib::Response& res) {
        if (req.path.rfind("/api/", 0) == 0 && res.status == 404 && res.body.empty())
            sendError(res, 404, "not_found", "没有这个接口: " + req.path);
    });

    // 处理函数里抛出的异常（比如数据库错误）→ 500，服务器不会崩
    srv.set_exception_handler([](const httplib::Request&, httplib::Response& res,
                                 std::exception_ptr ep) {
        std::string what = "unknown";
        try { if (ep) std::rethrow_exception(ep); }
        catch (const std::exception& e) { what = e.what(); }
        catch (...) {}
        sendError(res, 500, "server_error", "服务器内部错误: " + what);
    });
}

} // namespace blindbox
