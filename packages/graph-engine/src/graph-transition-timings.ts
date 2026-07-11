/**
 * 社区阅读回全图的退出过渡时长（毫秒）。复用 #118 的共享 Sigma 视图过渡基座，
 * 只把退出镜头节奏收得比进入更短、更克制（设计文档 §动效节奏：「退出社区时应更短」）：
 * 社区细节随内容切换即时退下，镜头用这段时间拉回全局构图，来源社区高亮保留。
 * 低于 #120 进入社区的工作台编排时长 COMMUNITY_ENTER_EXIT_DURATION_MS（320）。
 */
export const SIGMA_COMMUNITY_RETURN_GLOBAL_TRANSITION_MS = 260;
