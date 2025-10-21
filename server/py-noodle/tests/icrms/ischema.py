import c_two as cc
from typing import Any, Tuple, List

@cc.icrm()
class ISchema:
    """
    ICRM
    =
    Interface of Core Resource Model (ICRM) specifies how to interact with CRM. 
    """
    def get_epsg(self) -> str:
        """
        获取EPSG坐标系代码
        
        Returns:
            str: EPSG坐标系代码字符串
        """
        ...

    def get_alignment_point(self) -> Tuple[float, float]:
        """
        获取对齐点的经纬度坐标
        
        Returns:
            Tuple[float, float]: 对齐点的经纬度坐标 (经度, 纬度)
        """
        ...
        
    def get_level_resolutions(self) -> List[Tuple[float, float]]:
        """
        获取各级别的分辨率信息
        
        Returns:
            List[Tuple[float, float]]: 每个级别的分辨率信息 [(宽度, 高度), ...]
        """
        ...
        
    def update_info(self, info: dict) -> dict:
        """
        更新Schema信息
        参数:
            info (dict): 包含要更新的信息的字典
        返回:
            dict: 操作结果，包含成功状态和消息
        """
        ...
        
    def adjust_rules(self, rules: dict) -> dict:
        """
        调整网格细分规则
        参数:
            rules (dict): 包含新网格细分规则的字典
        返回:
            dict: 操作结果，包含成功状态和消息
        """
        ...