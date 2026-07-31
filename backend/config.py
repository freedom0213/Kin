"""Kin 后端配置"""

import os


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

# JWT 配置
JWT_SECRET = os.getenv("KIN_JWT_SECRET", "kin-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 168  # 7 天，MVP 阶段简化

# 数据库路径
DB_PATH = os.getenv("KIN_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "kin.db"))

# 用户上传媒体（开发阶段保存在 Kin 本地后端；生产环境可替换为对象存储）
MEDIA_ROOT = os.getenv("KIN_MEDIA_ROOT", os.path.join(os.path.dirname(__file__), "data", "media"))
PROFILE_BANNER_DIR = os.path.join(MEDIA_ROOT, "profile-banners")
MAX_PROFILE_BANNER_BYTES = int(os.getenv("KIN_MAX_PROFILE_BANNER_BYTES", str(5 * 1024 * 1024)))

# 用户名校验规则
USERNAME_MIN_LEN = 4
USERNAME_MAX_LEN = 16
USERNAME_REGEX = r"^[a-zA-Z][a-zA-Z0-9_]*$"  # 字母开头，字母/数字/下划线
USERNAME_FORBIDDEN = ["admin", "system", "kin", "null", "root"]  # 保留用户名

# 密码校验规则
PASSWORD_MIN_LEN = 8
PASSWORD_MAX_LEN = 32
PASSWORD_REQUIRE_LETTER = True   # 必须含字母
PASSWORD_REQUIRE_DIGIT = True    # 必须含数字
PASSWORD_ALLOWED_SPECIAL = "!@#$%^&*._-"  # 允许的特殊字符

# 好友上限
MAX_FRIENDS = 100

# NFC token 有效期（秒）
NFC_TOKEN_TTL = 60

# NFC 双方确认配对会话有效期（秒）
PAIRING_SESSION_TTL = int(os.getenv("KIN_PAIRING_SESSION_TTL", "120"))

# 离线加密消息
OFFLINE_MESSAGE_TTL_DAYS = int(os.getenv("KIN_OFFLINE_MESSAGE_TTL_DAYS", "7"))
MAX_MESSAGE_BYTES = int(os.getenv("KIN_MAX_MESSAGE_BYTES", str(8 * 1024 * 1024)))

# Expo Push 服务
EXPO_PUSH_URL = os.getenv("KIN_EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_PUSH_ACCESS_TOKEN = os.getenv("KIN_EXPO_PUSH_ACCESS_TOKEN", "")
EXPO_PUSH_TIMEOUT_SECONDS = float(os.getenv("KIN_EXPO_PUSH_TIMEOUT_SECONDS", "5"))

# 仅开发/内部测试环境使用。默认关闭，避免生产环境意外创建公开测试账号。
SEED_TEST_ACCOUNTS = _env_flag("KIN_SEED_TEST_ACCOUNTS")
