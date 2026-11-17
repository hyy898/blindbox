#include "browser_session.h"

#include <iostream>
#include <memory>

#include "httplib.h"

namespace blindbox {

struct BrowserSession::Lease {
    explicit Lease(BrowserSession& owner) : owner(owner) { owner.connect(); }
    ~Lease() { owner.disconnect(); }
    BrowserSession& owner;
};

BrowserSession::BrowserSession(httplib::Server& server, bool enabled)
    : server_(server), enabled_(enabled) {
    server_.Get("/api/session", [this](const httplib::Request& req, httplib::Response& res) {
        // 普通服务器模式不跟随浏览器退出；204 会让 EventSource 停止重连。
        if (!enabled_ || req.method != "GET") { res.status = 204; return; }
        auto lease = std::make_shared<Lease>(*this);
        res.set_header("Cache-Control", "no-store");
        res.set_header("X-Accel-Buffering", "no");
        res.set_chunked_content_provider("text/event-stream",
            [this, lease](size_t offset, httplib::DataSink& sink) {
                if (offset == 0) {
                    static const std::string hello = "retry: 1000\ndata: connected\n\n";
                    return sink.write(hello.data(), hello.size());
                }
                if (!waitForPulse()) { sink.done(); return true; }
                static const std::string pulse = ": keep-alive\n\n";
                return sink.write(pulse.data(), pulse.size());
            });
    });
}

BrowserSession::~BrowserSession() { finish(); }

void BrowserSession::start() {
    if (!enabled_ || watcher_.joinable()) return;
    started_ = Clock::now();
    watcher_ = std::thread([this] { watch(); });
}

void BrowserSession::finish() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        finished_ = true;
    }
    changed_.notify_all();
    if (watcher_.joinable()) watcher_.join();
}

void BrowserSession::connect() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        ++clients_;
        connectedOnce_ = true;
    }
    changed_.notify_all();
}

void BrowserSession::disconnect() {
    {
        std::lock_guard<std::mutex> lock(mu_);
        --clients_;
        if (clients_ == 0) lastClosed_ = Clock::now();
    }
    changed_.notify_all();
}

bool BrowserSession::waitForPulse() {
    std::unique_lock<std::mutex> lock(mu_);
    return !changed_.wait_for(lock, std::chrono::milliseconds(500), [this] { return finished_; });
}

void BrowserSession::watch() {
    std::unique_lock<std::mutex> lock(mu_);
    while (!finished_) {
        if (clients_ != 0) { changed_.wait(lock); continue; }
        // 允许刷新、跳转后返回和 EventSource 自动重连；没有打开网页时也不常驻后台。
        auto deadline = connectedOnce_ ? lastClosed_ + std::chrono::seconds(5)
                                      : started_ + std::chrono::seconds(90);
        if (Clock::now() < deadline || !server_.is_running()) {
            changed_.wait_until(lock, deadline);
            continue;
        }
        finished_ = true;
        bool hadPage = connectedOnce_;
        lock.unlock();
        changed_.notify_all();
        std::cout << (hadPage ? "游戏网页已全部关闭，正在自动退出服务器。\n"
                             : "90 秒内没有打开游戏网页，正在自动退出服务器。\n") << std::flush;
        server_.stop();
        return;
    }
}

} // namespace blindbox
