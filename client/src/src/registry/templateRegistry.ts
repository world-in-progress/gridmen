import DefaultTemplate from "@/template/default/default"
import SchemaTemplate from "@/template/schema/schema"

const _TEMPLATE_REGISTRY: Record<string, typeof DefaultTemplate> = {
    [DefaultTemplate.templateName]: DefaultTemplate,
    [SchemaTemplate.templateName]: SchemaTemplate
}

export const TEMPLATE_REGISTRY = new Proxy(_TEMPLATE_REGISTRY, {
    get(target, prop: string) {
        return target[prop] || DefaultTemplate
    }
})

