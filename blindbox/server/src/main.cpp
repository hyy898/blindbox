// main.cpp —— 程序入口：解析命令行、检查配置、打开存档、启动 HTTP 服务器
//
// 一个 exe 同时做三件事：
//   1. 提供网页（index.html 等）和 models/ 里的模型文件
//   2. 提供 /api/* 游戏接口（规则在 economy.cpp，配置在 game_config.cpp）
//   3. 把存档写进 SQLite 数据库（默认 data/blindbox-save.db）
//
// 常用命令：
//   blindbox-server                     本机运行，端口 8765，网页目录 = exe 所在目录
//   blindbox-server --open              启动后自动打开浏览器（启动游戏.bat 用的就是这个）
//   blindbox-server --check-config      只检查 game_config.cpp 的配置，然后退出
//   blindbox-server --dump-config       打印配置 JSON（和 /api/config 一样）
//   blindbox-server --simulate 1000     用真实规则模拟 1000 局通关，统计开盒数和用时
//   blindbox-server --host 0.0.0.0 --port 8080 部署到公网服务器
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>  // ShellExecuteA：打开浏览器
#endif

#include "browser_session.h"
#include "config.h"
#include "economy.h"
#include "httplib.h"
#include "routes.h"
#include "model_assets.h"
#include "simulate.h"
#include "store.h"

namespace fs = std::filesystem;
using namespace blindbox;

namespace {

struct Options {
    std::string host = "127.0.0.1"; // 只允许本机访问；公网部署用 0.0.0.0
    int port = 8765;
    std::string webRoot;            // 网页目录，空 = 自动找
    std::string modelsDir;          // 模型目录，空 = <网页目录>/models
    std::string dbPath;             // 存档，空 = <exe 目录>/data/blindbox-save.db
    uint64_t seed = 0;              // 随机种子，0 = 真随机（测试时用固定种子）
    bool exitOnClose = false;       // 启动器使用：最后一个网页关闭后自动退出
    bool openBrowser = false;
    bool checkOnly = false;
    bool dumpConfig = false;
    bool modelsReadmeOnly = false;  // 只生成 models/README.txt 然后退出
    std::string dumpPath;           // 空 = 输出到屏幕
    int simulateRuns = 0;           // >0 = 只做通关模拟
    double secondsPerBox = 20;      // 模拟用：每开一盒大约多少秒
};

void printUsage() {
    std::cout <<
        "用法: blindbox-server [选项]\n"
        "  --host <地址>         监听地址，默认 127.0.0.1（公网部署用 0.0.0.0）\n"
        "  --port <端口>         默认 8765，被占用时自动尝试后面 9 个端口\n"
        "  --web <目录>          网页目录（含 index.html），默认 exe 所在目录\n"
        "  --models <目录>       模型目录，默认 <网页目录>/models\n"
        "  --db <文件>           存档数据库，默认 <exe 目录>/data/blindbox-save.db\n"
        "  --seed <数字>         固定随机种子（测试用）\n"
        "  --open                启动后自动打开浏览器\n"
        "  --exit-on-close       所有游戏网页关闭后自动退出（刷新有 4 秒宽限）\n"
        "  --check-config        只检查配置是否正确\n"
        "  --dump-config [文件]  导出配置 JSON（和 /api/config 一样）\n"
        "  --simulate <局数>     通关模拟（可配 --seed、--seconds-per-box，默认 20 秒/盒）\n"
        "  --models-readme       只生成 models/README.txt（模型文件名清单）\n";
}

bool parseArgs(int argc, char** argv, Options& o) {
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto next = [&](const char* name) -> std::string {
            if (i + 1 >= argc) {
                std::cerr << "参数 " << name << " 后面缺少值\n";
                std::exit(2);
            }
            return argv[++i];
        };
        if (a == "--host") o.host = next("--host");
        else if (a == "--port") o.port = std::atoi(next("--port").c_str());
        else if (a == "--web") o.webRoot = next("--web");
        else if (a == "--models") o.modelsDir = next("--models");
        else if (a == "--db") o.dbPath = next("--db");
        else if (a == "--seed") o.seed = std::strtoull(next("--seed").c_str(), nullptr, 10);
        else if (a == "--exit-on-close") o.exitOnClose = true;
        else if (a == "--open") o.openBrowser = true;
        else if (a == "--check-config") o.checkOnly = true;
        else if (a == "--models-readme") o.modelsReadmeOnly = true;
        else if (a == "--simulate") o.simulateRuns = std::atoi(next("--simulate").c_str());
        else if (a == "--seconds-per-box") o.secondsPerBox = std::atof(next("--seconds-per-box").c_str());
        else if (a == "--dump-config") {
            o.dumpConfig = true;
            if (i + 1 < argc && argv[i + 1][0] != '-') o.dumpPath = argv[++i];
        } else if (a == "-h" || a == "--help") {
            printUsage();
            std::exit(0);
        } else {
            std::cerr << "不认识的参数: " << a << "\n";
            printUsage();
            return false;
        }
    }
    if (o.port <= 0 || o.port > 65535) {
        std::cerr << "端口不合法\n";
        return false;
    }
    return true;
}

// exe 所在目录（双击运行时当前目录不一定是 exe 目录）
fs::path exeDir(const char* argv0) {
#ifdef _WIN32
    wchar_t buf[MAX_PATH];
    DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH) return fs::path(buf).parent_path();
#else
    std::error_code ec;
    fs::path p = fs::read_symlink("/proc/self/exe", ec); // Linux
    if (!ec) return p.parent_path();
#endif
    std::error_code ec2;
    fs::path p2 = fs::absolute(argv0, ec2);
    return ec2 ? fs::current_path() : p2.parent_path();
}

// 用系统默认浏览器打开网址
void openInBrowser(const std::string& url) {
#ifdef _WIN32
    ShellExecuteA(nullptr, "open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif defined(__APPLE__)
    std::string cmd = "open '" + url + "' >/dev/null 2>&1 &";
    if (std::system(cmd.c_str()) != 0) std::cerr << "请手动打开: " << url << "\n";
#else
    std::string cmd = "xdg-open '" + url + "' >/dev/null 2>&1 &";
    if (std::system(cmd.c_str()) != 0) std::cerr << "请手动打开: " << url << "\n";
#endif
}

// 根据配置生成 models/README.txt，列出每个手办应该叫什么文件名、现在有没有
void writeModelsReadme(const GameConfig& cfg, const fs::path& dir) {
    std::error_code ec;
    fs::create_directories(dir, ec);
    std::ofstream out(dir / "README.txt", std::ios::binary);
    if (!out) return;
    out << "把 Lux3D 生成的 .glb 模型放进这个文件夹，文件名必须和下面一致。\n"
           "缺了的会自动显示占位几何体。本文件由 blindbox-server 启动时根据\n"
           "server/src/game_config.cpp 自动生成，改了配置会自动更新。\n\n";
    for (const auto& s : cfg.series) {
        out << "【" << s.name << "】\n";
        for (const auto& it : s.items) {
            std::string file = cfg.modelFileOf(it);
            bool have = fs::exists(dir / file, ec);
            const Rarity* r = cfg.rarity(it.rarity);
            out << "  " << file << "\t" << it.name << "（" << (r ? r->label : it.rarity) << "）"
                << (have ? "\t[已放入]" : "\t[缺]") << "\n"
                << "      描述: " << it.desc << "\n";
        }
        out << "\n";
    }
}

} // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8); // 让黑窗口正确显示中文
#endif
    Options opt;
    if (!parseArgs(argc, argv, opt)) return 2;

    // ---------- 1. 读取并检查配置 ----------
    GameConfig cfg = buildGameConfig();
    finalizeConfig(cfg);
    auto errs = validateConfig(cfg);
    if (!errs.empty()) {
        std::cerr << "\n[配置错误] game_config.cpp 有 " << errs.size() << " 个问题：\n";
        for (const auto& e : errs) std::cerr << "  - " << e << "\n";
        std::cerr << "\n请改好 server/src/game_config.cpp 后重新编译。\n";
        return 3;
    }
    if (opt.checkOnly) {
        std::cout << "配置检查通过：" << cfg.series.size() << " 种盲盒，" << cfg.itemsById.size()
                  << " 个手办。\n";
        return 0;
    }
    if (opt.simulateRuns > 0) return runSimulation(cfg, opt.simulateRuns, opt.seed, opt.secondsPerBox);
    if (opt.dumpConfig) {
        std::string text = configToJson(cfg).dump(2) + "\n";
        if (opt.dumpPath.empty()) {
            std::cout << text;
        } else {
            std::ofstream out(opt.dumpPath, std::ios::binary);
            out << text;
            std::cout << "已导出配置到 " << opt.dumpPath << "\n";
        }
        return 0;
    }

    // ---------- 2. 目录 ----------
    fs::path base = exeDir(argv[0]);
    fs::path web = opt.webRoot.empty() ? base : fs::path(opt.webRoot);
    if (opt.webRoot.empty() && !fs::exists(web / "index.html") &&
        fs::exists(fs::current_path() / "index.html"))
        web = fs::current_path();
    fs::path models = opt.modelsDir.empty() ? web / "models" : fs::path(opt.modelsDir);
    fs::path db = opt.dbPath.empty() ? base / "data" / "blindbox-save.db" : fs::path(opt.dbPath);

    std::error_code ec;
    fs::create_directories(db.parent_path(), ec);
    writeModelsReadme(cfg, models);
    if (opt.modelsReadmeOnly) {
        std::cout << "已生成 " << (models / "README.txt").string() << "\n";
        return 0;
    }

    // ---------- 3. 存档 + 规则 ----------
    std::unique_ptr<Store> store;
    try {
        store = std::make_unique<Store>(db.string());
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 4;
    }
    Economy economy(cfg, opt.seed);
    AppContext app{cfg, economy, *store, {}, "4.1.0"};

    // ---------- 4. HTTP 服务器 ----------
    httplib::Server srv;
    srv.set_payload_max_length(64 * 1024); // 请求体最大 64KB，防止乱发大包
    srv.set_file_extension_and_mimetype_mapping("glb", "model/gltf-binary");
    srv.set_file_extension_and_mimetype_mapping("json", "application/json; charset=utf-8");

    // 不允许通过网页下载存档、exe、脚本
    srv.set_pre_routing_handler([&](const httplib::Request& req, httplib::Response& res) {
        const std::string& p = req.path;
        auto endsWith = [&](const char* suf) {
            std::string s(suf);
            return p.size() >= s.size() && p.compare(p.size() - s.size(), s.size(), s) == 0;
        };
        if (p.rfind("/data/", 0) == 0 || endsWith(".db") || endsWith(".db-wal") ||
            endsWith(".db-shm") || endsWith(".exe") || endsWith(".bat") || endsWith(".ps1") ||
            endsWith(".command") || p.find("/server/") != std::string::npos) {
            res.status = 404;
            res.set_content("404", "text/plain");
            return httplib::Server::HandlerResponse::Handled;
        }
        // Intercept before static mounts, including --web directories containing models/.
        if (p.rfind("/models/", 0) == 0 && (req.method == "GET" || req.method == "HEAD")) {
            model_assets::serve(req, res, cfg, models);
            return httplib::Server::HandlerResponse::Handled;
        }
        return httplib::Server::HandlerResponse::Unhandled;
    });
    // 网页保持不缓存；模型由前面的版本化处理器进行 ETag 校验。
    srv.set_file_request_handler([](const httplib::Request&, httplib::Response& res) {
        res.set_header("Cache-Control", "no-store");
    });

    registerRoutes(srv, app);
    BrowserSession browserSession(srv, opt.exitOnClose);

    model_assets::registerRoutes(srv, cfg, models);
    bool hasWeb = fs::exists(web / "index.html");
    if (hasWeb) srv.set_mount_point("/", web.string());

    // 端口被占用就往后试
    int port = -1;
    for (int p = opt.port; p < opt.port + 10; ++p) {
        if (srv.bind_to_port(opt.host, p)) {
            port = p;
            break;
        }
        std::cerr << "端口 " << p << " 被占用，尝试下一个…\n";
    }
    if (port < 0) {
        std::cerr << "没有可用端口，启动失败\n";
        return 5;
    }

    std::string shownHost = opt.host == "0.0.0.0" ? "127.0.0.1" : opt.host;
    std::string url = "http://" + shownHost + ":" + std::to_string(port) + "/";
    std::cout << "==============================================\n"
              << "  开盲盒服务器已启动  " << url << "\n"
              << "  网页目录: " << (hasWeb ? web.string() : "(没找到 index.html，只提供接口)") << "\n"
              << "  模型目录: " << models.string() << "\n"
              << "  存档文件: " << db.string() << "\n"
              << "  配置: " << cfg.series.size() << " 种盲盒 / " << cfg.itemsById.size() << " 个手办\n"
              << (opt.exitOnClose ? "  关闭所有游戏网页后会自动退出；刷新页面不会中断游戏\n"
                                  : "  关闭本窗口即可退出游戏服务器\n")
              << "==============================================\n"
              << std::flush;

    browserSession.start();
    if (opt.openBrowser && hasWeb) openInBrowser(url);

    bool listened = srv.listen_after_bind();
    browserSession.finish();
    return listened ? 0 : 5;
}
