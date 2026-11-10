# ---------------------------------------------------------------
# 开盲盒 C++ 后端
#   单个可执行文件 blindbox-server：同时提供网页、模型文件和 /api 接口。
#   依赖全部放在 third_party/（单头文件 / amalgamation），不用装任何包。
# ---------------------------------------------------------------
cmake_minimum_required(VERSION 3.16)
project(blindbox_server LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

# --- SQLite（官方 amalgamation，一个 .c 文件）编成静态库 ---
add_library(sqlite3 STATIC third_party/sqlite/sqlite3.c)
target_include_directories(sqlite3 PUBLIC third_party/sqlite)
target_compile_definitions(sqlite3 PRIVATE
  SQLITE_THREADSAFE=1          # 允许多线程（我们外面还有一把全局锁）
  SQLITE_OMIT_LOAD_EXTENSION   # 不需要加载扩展，也省掉 -ldl
  SQLITE_DEFAULT_FOREIGN_KEYS=1)

# --- 主程序 ---
add_executable(blindbox-server
  src/main.cpp
  src/config.cpp
  src/game_config.cpp
  src/economy.cpp
  src/store.cpp
  src/routes.cpp)
target_include_directories(blindbox-server PRIVATE
  src third_party/httplib third_party/nlohmann)
target_link_libraries(blindbox-server PRIVATE sqlite3)

find_package(Threads REQUIRED)
target_link_libraries(blindbox-server PRIVATE Threads::Threads)

if(WIN32)
  # cpp-httplib 需要 Winsock(ws2_32)；打开浏览器用 shell32
  target_link_libraries(blindbox-server PRIVATE ws2_32 shell32)
  target_compile_definitions(blindbox-server PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
  if(MSVC)
    # 源码是 UTF-8（含中文注释/字符串）
    target_compile_options(blindbox-server PRIVATE /utf-8 /W3)
    target_compile_options(sqlite3 PRIVATE /utf-8)
  endif()
  if(MINGW)
    # MinGW/Zig 交叉编译：静态链接，exe 不依赖额外 DLL
    target_link_options(blindbox-server PRIVATE -static)
  endif()
else()
  target_compile_options(blindbox-server PRIVATE -Wall -Wextra)
endif()
