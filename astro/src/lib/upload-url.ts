// Upload-URL rewriting lives in the CMS access layer (../cms/in-process/upload-url). Re-exported
// here for legacy import paths; new code should import from `../cms` (which picks the right
// backend for the active mode).
export { payloadUploadUrl } from "../cms/in-process/upload-url";
