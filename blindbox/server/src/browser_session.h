// 浏览器标签页保持一条 SSE 连接。最后一页关闭后，宽限几秒再退出本机服务器。
// 不依赖网页定时器，切到后台不会因为计时器被浏览器降频而误退出。
#pragma once
#include <chrono>
#include <cstddef>
#include <condition_variable>
#include <mutex>
#include <thread>

namespace httplib { class Server; }

namespace blindbox {

class BrowserSession {
public:
    BrowserSession(httplib::Server& server, bool enabled);
    ~BrowserSession();
    BrowserSession(const BrowserSession&) = delete;
    BrowserSession& operator=(const BrowserSession&) = delete;
    void start();
    void finish();

private:
    struct Lease;
    using Clock = std::chrono::steady_clock;
    httplib::Server& server_;
    const bool enabled_;
    std::mutex mu_;
    std::condition_variable changed_;
    std::thread watcher_;
    bool finished_ = false;
    bool connectedOnce_ = false;
    std::size_t clients_ = 0;
    Clock::time_point started_;
    Clock::time_point lastClosed_;
    void connect();
    void disconnect();
    bool waitForPulse();
    void watch();
};

} // namespace blindbox
