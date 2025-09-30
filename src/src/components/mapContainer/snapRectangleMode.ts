// @ts-expect-error 导入原始矩形模式
import DrawRectangle from 'mapbox-gl-draw-rectangle-mode';

// 吸附功能增强函数
const enhanceWithSnapping = (mode: any) => {
  const enhanced = Object.assign({}, mode);
  
  // 添加吸附坐标计算方法
  enhanced.getSnappedCoordinate = function(coord: any) {
    if (!this.map || !this.map.getSource) return coord;
    
    try {
      // 吸附配置
      const snapPx = 15;
      const snapPoint = this.map.project(coord);
      
      // 查询附近的要素 - 扩大查询范围
      const bbox = [
        [snapPoint.x - snapPx, snapPoint.y - snapPx],
        [snapPoint.x + snapPx, snapPoint.y + snapPx]
      ];
      
      let nearestVertex = null;
      let minDistance = snapPx;
      
      // 1. 查询地图上渲染的要素（包括patch bounds）
      const renderedFeatures = this.map.queryRenderedFeatures(bbox);
      renderedFeatures.forEach((feature: any) => {
        // 特别处理patch bounds图层
        if (feature.source && (
          feature.source.toString().includes('bounds-source') || 
          feature.source === 'confirmed-area' ||
          feature.source.startsWith('patch-')
        )) {
          if (feature.geometry && feature.geometry.coordinates) {
            const vertices = this.extractVertices(feature.geometry.coordinates);
            vertices.forEach((vertex: any) => {
              const vertexPoint = this.map.project(vertex);
              const distance = Math.sqrt(
                Math.pow(snapPoint.x - vertexPoint.x, 2) + 
                Math.pow(snapPoint.y - vertexPoint.y, 2)
              );
              
              if (distance < minDistance) {
                minDistance = distance;
                nearestVertex = vertex;
              }
            });
          }
        }
      });
      
      // 2. 查询已绘制的draw要素
      if (this.getAll) {
        const drawFeatures = this.getAll().features;
        drawFeatures.forEach((feature: any) => {
          if (feature.geometry && feature.geometry.coordinates) {
            const vertices = this.extractVertices(feature.geometry.coordinates);
            vertices.forEach((vertex: any) => {
              const vertexPoint = this.map.project(vertex);
              const distance = Math.sqrt(
                Math.pow(snapPoint.x - vertexPoint.x, 2) + 
                Math.pow(snapPoint.y - vertexPoint.y, 2)
              );
              
              if (distance < minDistance) {
                minDistance = distance;
                nearestVertex = vertex;
              }
            });
          }
        });
      }
      
      // 如果找到吸附点，可以添加视觉反馈
      if (nearestVertex && this.map) {
        // 这里可以添加吸附点的视觉指示器
        console.log('Snapped to vertex:', nearestVertex);
      }
      
      return nearestVertex || coord;
    } catch (e) {
      console.warn('Snap calculation error:', e);
      return coord;
    }
  };
  
  // 添加顶点提取辅助方法
  enhanced.extractVertices = function(coords: any): any[] {
    if (!coords) return [];
    
    if (Array.isArray(coords[0])) {
      if (Array.isArray(coords[0][0])) {
        // Polygon - 返回外环的顶点
        return coords[0] || [];
      } else {
        // LineString - 返回所有点
        return coords || [];
      }
    } else {
      // Point - 返回单点
      return [coords];
    }
  };
  
  // 保存原始方法
  const originalOnClick = enhanced.onClick;
  const originalOnMouseMove = enhanced.onMouseMove;
  
  // 增强点击事件
  enhanced.onClick = function(state: any, e: any) {
    const snappedCoord = this.getSnappedCoordinate([e.lngLat.lng, e.lngLat.lat]);
    e.lngLat = { lng: snappedCoord[0], lat: snappedCoord[1] };
    
    return originalOnClick.call(this, state, e);
  };
  
  // 增强鼠标移动事件
  enhanced.onMouseMove = function(state: any, e: any) {
    const snappedCoord = this.getSnappedCoordinate([e.lngLat.lng, e.lngLat.lat]);
    e.lngLat = { lng: snappedCoord[0], lat: snappedCoord[1] };
    
    return originalOnMouseMove.call(this, state, e);
  };
  
  return enhanced;
};

// 创建带吸附功能的矩形模式
const SnapRectangleMode = enhanceWithSnapping(DrawRectangle);

export default SnapRectangleMode;
