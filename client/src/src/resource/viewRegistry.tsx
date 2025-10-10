interface IViewConfig {
    Creation: string;
    Views: string[];
}

const _VIEW_REGISTRY: Record<string, IViewConfig> = {
    'Default': {
        Creation: 'Default',
        Views: []
    },
    'Schema': {
        Creation: 'Creation',
        Views: [
            'Preview',
            'Delete'
        ]
    },
    'Patch': {
        Creation: 'Creation',
        Views: [
            'Preview',
            'Topology',
            'Delete'
        ]
    }
}