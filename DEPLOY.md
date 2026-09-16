# Telegram File Monitor - Docker 构建与部署指南

## 目录

1. [准备工作](#1-准备工作)
2. [构建 Docker 镜像](#2-构建-docker-镜像)
3. [推送镜像到阿里云镜像仓库](#3-推送镜像到阿里云镜像仓库)
4. [在飞牛 NAS 上拉取并启动容器](#4-在飞牛-nas-上拉取并启动容器)
5. [容器管理常用命令](#5-容器管理常用命令)
6. [常见问题](#6-常见问题)

---

## 1. 准备工作

### 1.1 在开发机（Windows WSL）上安装 Docker

确保 WSL 内已安装 Docker：

```bash
# 在 WSL 内检查
docker version

# 如果没有安装，在 WSL（Ubuntu）内执行：
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# 退出 WSL 重新进入
```

### 1.2 登录阿里云镜像仓库

```bash
# 在 WSL 内执行
docker login --username=ybjwylyf registry.cn-hangzhou.aliyuncs.com
```

系统会提示输入密码（输入阿里云镜像仓库的密码，注意不是阿里云登录密码，需要去 [cr.console.aliyun.com](https://cr.console.aliyun.com) 设置 Registry 密码）。

### 1.3 确认代码结构

```
app/                             # 独立 Git 仓库（构建上下文）
├── Dockerfile                   # 构建文件
├── frontend/                    # React 前端（Vite + Tailwind）
├── server/                      # Hono 后端
│   └── package.json             # 已声明 node-telegram-bot-api 依赖
├── DEPLOY.md                    # 本文件
├── dev.ps1                      # 本地开发启动脚本
└── docker-build.ps1             # 一键构建推送脚本
```

> **注意**：Docker 构建上下文是 `app/` 目录本身，`app/` 已完全独立，不依赖仓库根目录。`server/package.json` 中声明了 `node-telegram-bot-api` 作为 npm 依赖，构建时自动从 npm 安装。

---

## 2. 构建 Docker 镜像

### 2.1 通过 PowerShell 脚本一键构建（推荐）

在 Windows 上打开 **PowerShell**，进入 `app/` 目录：

```powershell
cd D:\workplace\project\node-telegram-bot-api\app

# 构建并推送到阿里云
.\docker-build.ps1

# 构建但不推送（仅本地测试）
.\docker-build.ps1 -BuildOnly

# 构建指定版本号
.\docker-build.ps1 -Version v1.0.0
```

### 2.2 手动构建（在 WSL 内执行）

```bash
# 进入 app 目录
cd /path/to/app

# 构建镜像
docker build -t tgfiledownload:latest -f Dockerfile .

# 查看构建好的镜像
docker images tgfiledownload
```

镜像构建过程会输出类似以下日志：

```
# 第一阶段：构建前端
=> [frontend-builder 1/5] FROM oven/bun:1.4
=> [frontend-builder 4/5] RUN bun run build

# 第二阶段：构建最终镜像
=> [stage-1 4/8] COPY --from=frontend-builder /build/dist ./frontend/dist
=> exporting to image
```

构建完成后，镜像大小约 **200MB**（Bun 运行时 + 前端静态资源 + 后端代码）。

---

## 3. 推送镜像到阿里云镜像仓库

### 3.1 给镜像打标签

```bash
# 格式：docker tag <本地镜像名> registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:<版本号>

# 示例 - latest 版本
docker tag tgfiledownload:latest registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest

# 示例 - 带版本号
docker tag tgfiledownload:latest registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:v1.0.0
```

### 3.2 推送

```bash
# 推送 latest
docker push registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest

# 推送指定版本
docker push registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:v1.0.0
```

---

## 4. 在飞牛 NAS 上拉取并启动容器

### 4.1 SSH 登录飞牛

```bash
ssh admin@<飞牛IP地址>
```

### 4.2 拉取镜像

```bash
# 登录阿里云镜像仓库（只需要第一次）
docker login --username=ybjwylyf registry.cn-hangzhou.aliyuncs.com

# 拉取镜像
docker pull registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
```

### 4.3 创建数据目录

```bash
# 创建持久化数据目录（可自定义路径）
mkdir -p /volume1/docker/tg-monitor/db
mkdir -p /volume1/docker/tg-monitor/downloads
```

### 4.4 启动容器

```bash
docker run -d \
  --name tg-monitor \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /volume1/docker/tg-monitor/db:/app/data/db \
  -v /volume1/docker/tg-monitor/downloads:/app/data/downloads \
  registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `-d` | 后台运行 |
| `--name tg-monitor` | 容器名称 |
| `--restart unless-stopped` | 容器退出后自动重启 |
| `-p 3000:3000` | 映射端口（宿主机:容器），可按需修改左侧端口 |
| `-v /path/to/db:/app/data/db` | **持久化 SQLite 数据库**，配置不丢失 |
| `-v /path/to/downloads:/app/data/downloads` | **下载文件目录**，下载的文件会出现在这里 |

### 4.5 验证启动

```bash
# 查看容器运行状态
docker ps

# 查看容器日志
docker logs tg-monitor

# 测试 API
curl http://localhost:3000/api/status
```

预期输出：

```json
{"running":false}
```

> Bot `running: false` 是正常的，首次启动还没有配置 Token。打开浏览器访问 `http://<飞牛IP>:3000` 进入 Web 页面配置即可。

---

## 5. 容器管理常用命令

```bash
# 查看容器状态
docker ps -a

# 查看日志（实时）
docker logs -f tg-monitor

# 重启容器
docker restart tg-monitor

# 停止容器
docker stop tg-monitor

# 启动已停止的容器
docker start tg-monitor

# 删除容器（不会删除数据，数据在挂载卷中）
docker rm -f tg-monitor

# 进入容器内部
docker exec -it tg-monitor sh
```

---

## 6. 常见问题

### 6.1 端口被占用

如果 3000 端口已被占用，启动时修改宿主机的端口映射：

```bash
docker run -d \
  --name tg-monitor \
  --restart unless-stopped \
  -p 8080:3000 \          # 宿主机用 8080，映射到容器的 3000
  -v /volume1/docker/tg-monitor/db:/app/data/db \
  -v /volume1/docker/tg-monitor/downloads:/app/data/downloads \
  registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
```

访问时用 `http://<飞牛IP>:8080`。

### 6.2 如何更新版本

当你修改了代码并构建了新版本：

```bash
# 1. 在开发机上构建并推送新版本
cd D:\workplace\project\node-telegram-bot-api\app
.\docker-build.ps1 -Version v1.1.0

# 2. 在飞牛上拉取并重建容器
ssh admin@<飞牛IP>
docker pull registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
docker rm -f tg-monitor
# 然后重新运行 docker run 命令（与 4.4 节相同）
```

### 6.3 下载的文件在哪里？

下载的文件存放在挂载目录 `/volume1/docker/tg-monitor/downloads/` 中，你可以通过飞牛的文件管理器直接访问。

### 6.4 配置丢失了？

配置数据存储在 SQLite 数据库中，路径是挂载目录下的 `db/app.db`。只要 `-v /volume1/docker/tg-monitor/db:/app/data/db` 挂载正确，删除容器重建后配置不会丢失。

### 6.5 WSL 中 Docker 构建慢？

首次构建需要下载 `oven/bun:1.4` 基础镜像（约 150MB），会从 Docker Hub 拉取。后续构建会使用缓存，速度会快很多。如果网络慢，可以配置 Docker 镜像加速器。

---

## 附录：版本号命名规范

建议使用语义化版本号：

| 版本 | 说明 |
|------|------|
| `latest` | 最新稳定版，始终指向最新 |
| `v1.0.0` | 正式发布版 |
| `v1.1.0` | 增加功能 |
| `v1.1.1` | 修复 Bug |

每次发布时，建议推送两个标签：

```bash
docker tag tgfiledownload:latest registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
docker tag tgfiledownload:latest registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:v1.0.0

docker push registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:latest
docker push registry.cn-hangzhou.aliyuncs.com/ybjwylyf/tgfiledownload:v1.0.0
```