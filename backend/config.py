"""Kin 后端配置"""

import os

# JWT 配置
JWT_SECRET = os.getenv("KIN_JWT_SECRET", "kin-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 168  # 7 天，MVP 阶段简化

# 数据库路径
DB_PATH = os.getenv("KIN_DB_PATH", os.path.join(os.path.dirname(__file__), "data", "kin.db"))

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

# 离线加密消息
OFFLINE_MESSAGE_TTL_DAYS = int(os.getenv("KIN_OFFLINE_MESSAGE_TTL_DAYS", "7"))
MAX_MESSAGE_BYTES = int(os.getenv("KIN_MAX_MESSAGE_BYTES", str(8 * 1024 * 1024)))
