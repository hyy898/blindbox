// routes.cpp —— 全部 HTTP 接口
//
// 约定（详见 docs/api.md）：
//   · 请求和响应都是 JSON（UTF-8）
//   · 单机只有一份存档，接口不需要登录或 token；第一次访问时自动建档
//   · 成功： { "ok": true, ...数据..., "state": {...最新存档...}, "progress": {...} }
//   · 失败： { "ok": false, "error": "错误码", "message": "中文说明" }，HTTP 状态码 4xx
//   · 所有规则都在服务器上判断，前端只负责显示
#include "routes.h"

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

    // 重置进度：回到新开局
    srv.Post("/api/reset", [&](const httplib::Request&, httplib::Response& res) {
        withSave(app, res, [&](PlayerRow& p) {
            p.state = app.economy.newPlayer();
            return ActionResult::success();
        });
    });

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
