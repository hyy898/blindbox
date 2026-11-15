// Live model metadata. Never reads model bodies to populate the catalog.
#pragma once
#include <filesystem>
#include <chrono>
#include <sstream>
#include "config.h"
#include "httplib.h"

namespace blindbox {
namespace model_assets {
namespace fs = std::filesystem;
struct Asset {
    fs::path path;
    std::string version;
    uintmax_t bytes = 0;
    bool available = false;
};
inline Asset inspect(const fs::path& root, const std::string& file) {
    Asset out;
    std::error_code ec;
    const auto base = fs::weakly_canonical(root, ec);
    if (ec) return out;
    const auto path = fs::weakly_canonical(base / file, ec);
    if (ec || path == base) return out;
    const auto relative = path.lexically_relative(base);
    if (relative.empty() || relative.is_absolute() || *relative.begin() == "..") return out;
    if (!fs::is_regular_file(path, ec) || ec) return out;
    auto bytes = fs::file_size(path, ec);
    if (ec || bytes == 0) return out;
    const auto modified = fs::last_write_time(path, ec);
    if (ec) return out;
    std::ostringstream version;
    version << std::hex << bytes << '-' << std::chrono::duration_cast<std::chrono::nanoseconds>(modified.time_since_epoch()).count();
    out = {path, version.str(), bytes, true};
    return out;
}
inline void serve(const httplib::Request& req, httplib::Response& res, const GameConfig& cfg, const fs::path& root) {
    std::map<std::string, std::string> files;
    for (const auto& entry : cfg.itemsById) files[entry.first] = cfg.modelFileOf(entry.second);
        const auto file = req.path.substr(8);
        bool configured = false;
        for (const auto& entry : files) if (entry.second == file) { configured = true; break; }
        const auto asset = configured ? inspect(root, file) : Asset{};
        if (!asset.available) {
            res.status = 404;
            res.set_header("Cache-Control", "no-store");
            res.set_content("Model not found", "text/plain");
            return;
        }
        // An old version URL must never acquire the new file's bytes.
        if (req.has_param("v") && req.get_param_value("v") != asset.version) {
            res.status = 409;
            res.set_header("Cache-Control", "no-store");
            res.set_content("Model version changed; refresh model catalog", "text/plain");
            return;
        }
        const auto etag = "W/\"" + asset.version + "\"";
        res.set_header("ETag", etag);
        res.set_header("Cache-Control", "private, no-cache");
        if (req.get_header_value("If-None-Match") == etag) {
            res.status = 304;
            return;
        }
        res.set_file_content(asset.path.string(), "model/gltf-binary");
}
inline void registerRoutes(httplib::Server& server, const GameConfig& cfg, const fs::path& root) {
    // Copies avoid dangling references to registration stack parameters.
    std::map<std::string, std::string> files;
    for (const auto& entry : cfg.itemsById) files[entry.first] = cfg.modelFileOf(entry.second);
    server.Get("/api/models", [root, files](const httplib::Request&, httplib::Response& res) {
        auto models = nlohmann::json::object();
        for (const auto& entry : files) {
            const auto asset = inspect(root, entry.second);
            models[entry.first] = {{"available", asset.available}, {"bytes", asset.bytes},
                {"version", asset.available ? nlohmann::json(asset.version) : nlohmann::json(nullptr)},
                {"url", asset.available ? nlohmann::json("models/" + entry.second + "?v=" + asset.version) : nlohmann::json(nullptr)}};
        }
        res.set_header("Cache-Control", "no-store");
        res.set_content(nlohmann::json{{"models", models}}.dump(), "application/json; charset=utf-8");
    });

}
} // namespace model_assets
} // namespace blindbox
