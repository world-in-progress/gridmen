/**
 * 基础视图上下文接口
 * 所有视图上下文都应该继承这个接口
 */
export interface IViewContext {
    [key: string]: unknown
}

/**
 * 地图视图上下文
 * 包含地图实例的引用
 */

