// simulate.h —— 通关模拟：用真实规则（economy.cpp）模拟很多局，统计要开多少盒、多长时间
//
//   blindbox-server --simulate 1000            模拟 1000 局
//   blindbox-server --simulate 1000 --seed 7   固定种子，结果可复现
//
// 改了 game_config.cpp 的价格/掉率后跑一下，就能知道一局大概玩多久。
#pragma once
#include <cstdint>

#include "config.h"

namespace blindbox {

// 返回 0 = 正常；打印结果到标准输出
int runSimulation(const GameConfig& cfg, int runs, uint64_t seed, double secondsPerBox);

} // namespace blindbox
