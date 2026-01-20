import { decodeNodeInfo } from './utils'
import { GridBlockMetaInfo } from '@/core/grid/types'
import { BaseResponse, MultiCellBaseInfo, PatchMeta } from './types'

const API_PREFIX = `/api/grid`
const UNDELETED_FLAG = 0