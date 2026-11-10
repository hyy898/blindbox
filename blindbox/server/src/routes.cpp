// routes.cpp —— 全部 HTTP 接口
//
// 约定（详见 docs/api.md）：
//   · 请求和响应都是 JSON（UTF-8）
//   · 需要登录的接口在请求头带  Authorization: Bearer <token>
//   · 成功： { "ok": true, ...数据..., "state": {...最新存档...} }
//   · 失败： { "ok": false, "error": "错误码", "message": "中文说明" }，HTTP 状态码 4xx
//   · 所有规则都在服务器上判断，前端只负责显示
#include "routes.h"

#include <random>
#include <sstream>
#include <iomanip>

#include "httplib.h"

namespace blindbox {

using nlohmann::json;

namespace {

// ---------- 小工具 ----------

void sendJson(httplib::Response& res, int status, const json& body) {
    res.status = status;
    res.set_content(body.dump(), "application/json; charset=utf-8");
}

void sendError(httplib::Response& res, int status, const std::string& code,
               const std::string& message) {
    sendJson(res, status, {{"ok", false}, {"error", code}, {"message", message}});
}

// 生成 n 字节的随机十六进制串（用作 token / 玩家 id）
std::string randomHex(size_t bytes) {
    static std::random_device rd; // 系统随机源
    std::ostringstream os;
    for (size_t i = 0; i < bytes; ++i)
        os << std::hex << std::setw(2) << std::setfill('0') << (rd() & 0xff);
    return os.str();
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

// 从请求头取 token： "Authorization: Bearer xxx" 或 "X-Player-Token: xxx"
std::string tokenOf(const httplib::Request& req) {
    std::string auth = req.get_header_value("Authorization");
    const std::string prefix = "Bearer ";
    if (auth.compare(0, prefix.size(), prefix) == 0) return auth.substr(prefix.size());
    return req.get_header_value("X-Player-Token");
}

// 昵称：去掉控制字符，最长 20 字节左右（中文约 6 个字），空则给默认名
std::string cleanNickname(std::string s) {
    std::string out;
    for (unsigned char c : s)
        if (c >= 0x20 && c != 0x7f && c != '<' && c != '>') out += (char)c;
    if (out.size() > 24) {
        // 不截断半个 UTF-8 字符：回退到字符边界
        size_t n = 24;
        while (n > 0 && ((unsigned char)out[n] & 0xC0) == 0x80) --n;
        out.resize(n);
    }
    return out.empty() ? "玩家" : out;
}

json playerInfo(const PlayerRow& p) { return {{"id", p.id}, {"nickname", p.nickname}}; }

// ---------- 需要登录的接口统一走这里 ----------
//
// 流程：加锁 → 用 token 读档 → 执行 action（修改存档）→ 成功就存档 → 回复
// action 返回 ActionResult；失败的话存档不会被保存（等于什么都没发生）
template <typename Fn>
void withPlayer(AppContext& app, const httplib::Request& req, httplib::Response& res, Fn action) {
    std::lock_guard<std::mutex> lock(app.mu);
    std::string token = tokenOf(req);
    if (token.empty() || token.size() > 128) {
        sendError(res, 401, "no_token", "请先创建玩家（POST /api/player）");
        return;
    }
    auto player = app.store.findByToken(token);
    if (!player) {
        sendError(res, 401, "bad_token", "登录信息无效，请重新创建玩家");
        return;
    }
    ActionResult r = action(*player);
    if (!r.ok) {
        sendError(res, r.httpStatus, r.error, r.message);
        return;
    }
    app.store.saveState(player->id, player->state);
    json body = r.data;
    body["ok"] = true;
    body["player"] = playerInfo(*player);
    body["state"] = stateToJson(player->state);
    sendJson(res, 200, body);
}

} // namespace

void registerRoutes(httplib::Server& srv, AppContext& app) {
    // ---------------- CORS ----------------
    // 允许别的网页（例如部署在别处的前端）调用本接口。
    // 我们用请求头里的 token 而不是 cookie，所以放开 * 是安全的。
    srv.set_default_headers({
        {"Access-Control-Allow-Origin", "*"},
        {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
        {"Access-Control-Allow-Headers", "Content-Type, Authorization, X-Player-Token"},
        {"Access-Control-Max-Age", "86400"},
        {"Access-Control-Expose-Headers", "X-Blindbox-Server"},
        // 前端靠这个响应头判断"网页是不是由 blindbox-server 提供的"
        {"X-Blindbox-Server", app.version},
    });
    srv.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    // ---------------- 公开接口 ----------------

    // 健康检查：前端靠它判断"服务器在不在"，不在就切单机模式
    srv.Get("/api/health", [&](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(app.mu);
        sendJson(res, 200, {{"ok", true}, {"name", "blindbox-server"},
                            {"version", app.version}, {"players", app.store.playerCount()}});
    });

    // 游戏配置（来自 game_config.cpp）。前端用它画商店、展柜和手办
    auto sendConfig = [&](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", "no-store");
        res.set_content(configToJson(app.cfg).dump(), "application/json; charset=utf-8");
    };
    srv.Get("/api/config", sendConfig);
    // 兼容：前端旧代码会读 ./items.json，由服务器直接给出同一份配置
    srv.Get("/items.json", sendConfig);

    // 创建匿名玩家：返回 id（公开）和 token（相当于密码，前端存在 localStorage）
    srv.Post("/api/player", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        if (!parseBody(req, res, body)) return;
        std::string nick = body.contains("nickname") && body["nickname"].is_string()
                               ? body["nickname"].get<std::string>()
                               : "";
        PlayerRow row;
        row.id = "p" + randomHex(6);
        row.token = randomHex(24);
        row.nickname = cleanNickname(nick);
        row.state = app.economy.newPlayer();
        {
            std::lock_guard<std::mutex> lock(app.mu);
            app.store.createPlayer(row);
        }
        sendJson(res, 200, {{"ok", true}, {"id", row.id}, {"token", row.token},
                            {"player", playerInfo(row)}, {"state", stateToJson(row.state)}});
    });

    // 排行榜（本机所有玩家的个人记录；部署到公网时就是全服排行）
    srv.Get("/api/leaderboard", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = 10;
        if (req.has_param("limit")) {
            try { limit = std::stoi(req.get_param_value("limit")); } catch (...) {}
        }
        if (limit < 1) limit = 1;
        if (limit > 50) limit = 50;
        std::lock_guard<std::mutex> lock(app.mu);
        json value = json::array(), fastest = json::array();
        int rank = 1;
        for (const auto& r : app.store.topShowcaseValue(limit))
            value.push_back({{"rank", rank++}, {"id", r.id}, {"nickname", r.nickname},
                             {"value", r.value}});
        rank = 1;
        for (const auto& r : app.store.fastestWins(limit))
            fastest.push_back({{"rank", rank++}, {"id", r.id}, {"nickname", r.nickname},
                               {"boxes", r.value}});
        sendJson(res, 200, {{"ok", true}, {"showcaseValue", value}, {"fastestWin", fastest}});
    });

    // ---------------- 需要 token 的接口 ----------------

    // 读取自己的存档
    srv.Get("/api/state", [&](const httplib::Request& req, httplib::Response& res) {
        withPlayer(app, req, res, [&](PlayerRow&) { return ActionResult::success(); });
    });

    // 开盒：{ "seriesId": "midnight-snack" }
    srv.Post("/api/open", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string seriesId;
        if (!parseBody(req, res, body) || !requireString(body, "seriesId", res, seriesId)) return;
        withPlayer(app, req, res, [&](PlayerRow& p) { return app.economy.open(p.state, seriesId); });
    });

    // 展示中的手办 → 展柜（展柜已有同款会自动进仓库）
    srv.Post("/api/showcase", [&](const httplib::Request& req, httplib::Response& res) {
        withPlayer(app, req, res,
                   [&](PlayerRow& p) { return app.economy.pendingToShowcase(p.state); });
    });

    // 展示中的手办 → 仓库（点空白处关闭展示界面）
    srv.Post("/api/storage", [&](const httplib::Request& req, httplib::Response& res) {
        withPlayer(app, req, res,
                   [&](PlayerRow& p) { return app.economy.pendingToStorage(p.state); });
    });

    // 仓库里的手办重新打开展示界面：{ "uid": "u3" }
    srv.Post("/api/reopen", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string uid;
        if (!parseBody(req, res, body) || !requireString(body, "uid", res, uid)) return;
        withPlayer(app, req, res,
                   [&](PlayerRow& p) { return app.economy.reopenFromStorage(p.state, uid); });
    });

    // 卖给系统：
    //   { "from": "pending" }                                  卖展示中的
    //   { "from": "storage",  "uid": "u3" }                    卖仓库里的
    //   { "from": "showcase", "seriesId": "...", "itemId": "..." } 卖展柜里的
    srv.Post("/api/sell", [&](const httplib::Request& req, httplib::Response& res) {
        json body;
        std::string from;
        if (!parseBody(req, res, body) || !requireString(body, "from", res, from)) return;
        if (from == "pending") {
            withPlayer(app, req, res, [&](PlayerRow& p) { return app.economy.sellPending(p.state); });
        } else if (from == "storage") {
            std::string uid;
            if (!requireString(body, "uid", res, uid)) return;
            withPlayer(app, req, res,
                       [&](PlayerRow& p) { return app.economy.sellFromStorage(p.state, uid); });
        } else if (from == "showcase") {
            std::string sid, iid;
            if (!requireString(body, "seriesId", res, sid) ||
                !requireString(body, "itemId", res, iid))
                return;
            withPlayer(app, req, res, [&](PlayerRow& p) {
                return app.economy.sellFromShowcase(p.state, sid, iid);
            });
        } else {
            sendError(res, 400, "bad_param", "from 只能是 pending / storage / showcase");
        }
    });

    // 申请破产补助（条件不满足会被拒绝）
    srv.Post("/api/bailout", [&](const httplib::Request& req, httplib::Response& res) {
        withPlayer(app, req, res, [&](PlayerRow& p) { return app.economy.bailout(p.state); });
    });

    // 重置进度（个人记录保留）
    srv.Post("/api/reset", [&](const httplib::Request& req, httplib::Response& res) {
        withPlayer(app, req, res, [&](PlayerRow& p) {
            PlayerState fresh = app.economy.newPlayer();
            fresh.bestShowcaseValue = p.state.bestShowcaseValue;
            fresh.fastestWinBoxes = p.state.fastestWinBoxes;
            p.state = fresh;
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
