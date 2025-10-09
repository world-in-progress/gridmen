declare module '@mapbox/mapbox-gl-draw' {
  interface MapboxDrawOptions {
    snap?: boolean;
    snapOptions?: {
      snapPx?: number;
      snapToMidPoints?: boolean;
      snapVertexPriorityDistance?: number;
      snapGetFeatures?: (map: any, draw: any) => any[];
    };
    guides?: boolean;
  }
}
