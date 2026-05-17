declare module 'react-cytoscapejs' {
  import type cytoscape from 'cytoscape';
  const CytoscapeComponent: React.FC<{
    elements?: any[];
    stylesheet?: cytoscape.StylesheetCSS[];
    layout?: Record<string, any>;
    style?: React.CSSProperties;
    cy?: (cy: cytoscape.Core) => void;
    className?: string;
    wheelSensitivity?: number;
    minZoom?: number;
    maxZoom?: number;
    panningEnabled?: boolean;
    zoomingEnabled?: boolean;
    [key: string]: any;
  }>;
  export default CytoscapeComponent;
}

declare module 'cytoscape-cose-bilkent' {
  import type cytoscape from 'cytoscape';
  const coseBilkent: cytoscape.Ext;
  export default coseBilkent;
}
