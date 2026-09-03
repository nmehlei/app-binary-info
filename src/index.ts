export { parse, type AppInfo } from "./detect";
export { parseApk, type AndroidAppInfo } from "./android/apk";
export { parseIpa, type IosAppInfo } from "./ios/ipa";
export { UnsupportedFileError, ParseError } from "./errors";