import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));

function pngSize(file) {
  const data = fs.readFileSync(file);
  if (data.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file} 不是 PNG`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

const iconPath = path.join(root, "assets/icon.png");
const foregroundPath = path.join(root, "assets/android-icon-foreground.png");
const [iconWidth, iconHeight] = pngSize(iconPath);
const [foregroundWidth, foregroundHeight] = pngSize(foregroundPath);
const adaptive = config.expo?.android?.adaptiveIcon || {};

const checks = [
  [config.expo?.icon === "./assets/icon.png", "expo.icon 必须引用新的 icon.png"],
  [iconWidth === 1024 && iconHeight === 1024, "普通图标必须为 1024×1024"],
  [foregroundWidth === 1024 && foregroundHeight === 1024, "Adaptive foreground 必须为 1024×1024"],
  [adaptive.foregroundImage === "./assets/android-icon-foreground.png", "Adaptive foreground 引用错误"],
  [adaptive.backgroundColor === "#000000", "Adaptive background 必须为纯黑"],
  [!("monochromeImage" in adaptive), "未批准的旧 monochromeImage 不应继续引用"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(`Kin 图标检查失败：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS: Kin 使用黑底人物图标并保留 Android Adaptive Icon 安全区");
