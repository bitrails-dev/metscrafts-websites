// Content reads now live in the switchable CMS access layer (../cms): in-process Local API by
// default, REST to the CMS server when CMS_MODE=api. This file is kept as a thin re-export so
// existing `import { getCollection } from '../../lib/cms'` call sites keep working unchanged.
export { getCollection, type CollectionName } from "../cms";
