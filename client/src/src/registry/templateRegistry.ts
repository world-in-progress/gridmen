import { ITemplate } from "@/template/iTemplate"
import DefaultTemplate from "@/template/default/default"
import SchemaTemplate from "@/template/schema/schema"
import PatchTemplate from "@/template/patch/patch"
import GridTemplate from "@/template/grid/grid"
import VectorTemplate from "@/template/vector/vector"

const defaultTemplate = new DefaultTemplate()
const schemaTemplate = new SchemaTemplate()
const patchTemplate = new PatchTemplate()
const gridTemplate = new GridTemplate()
const vectorTemplate = new VectorTemplate()

const _TEMPLATE_REGISTRY: Record<string, ITemplate> = {
    [defaultTemplate.templateName]: defaultTemplate,
    [schemaTemplate.templateName]: schemaTemplate,
    [patchTemplate.templateName]: patchTemplate,
    [gridTemplate.templateName]: gridTemplate,
    [vectorTemplate.templateName]: vectorTemplate,
}

// 拦截对_TEMPLATE_REGISTRY属性值的访问行为，防止取得undefined的template对象
// 比如后端创建了新的template类型，但是前端没有更新，访问时就会返回defaultTemplate对象
export const TEMPLATE_REGISTRY = new Proxy(_TEMPLATE_REGISTRY, {
    get(target, prop: string) {
        return target[prop] || defaultTemplate
    }
})

