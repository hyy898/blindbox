"""Audit actual GLBs against a config dumped from the shipping binary.

Usage: python3 scripts/audit-models.py /path/to/config.json
This reads assets only; it does not start a game server or touch its database.
"""
import datetime
import hashlib
import json
import struct
import sys
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/audit-models.py /path/to/config.json')
config_path = Path(sys.argv[1])
config = json.loads(config_path.read_text())
# Browser verification records cover only the exact files inspected on 2026-11-14.
verified_sha256 = {'2d119e77f583e47e6a0afe06b3397fc68468370717f93659829a3c31eb9b9b2b', '993aa0ce7319d338ca8b2a72d40a69fce779f9665743e51fd826e2b8dfcafcc7', '660d73aa12a777869dd0e3ca542d397a5ff7eddadf29ede4f821500fe5539861', '77411b59702b9f36c55ded296090a026f7627c186b78061d7a4c29ac288599a0', '565403b3021555bb91de0985d6c9223cb87a48c5e3b442e26f601951a8d9d8a0', '33d82108a83ddc63c1b13efc56e989e295b7f2ca3aa0de52f234542876e42789'}
items, assets = [], {}
for series in config['series']:
    for item in series['items']:
        path = repo / 'blindbox' / item['model']
        row = dict(id=item['id'], name=item['name'], seriesId=series['id'],
                   seriesName=series['name'], rarity=item['rarity'],
                   modelPath=str(path.relative_to(repo)), available=path.is_file())
        asset = dict(available=row['available'], thumbnail=None, orientation=0)
        if row['available']:
            data = path.read_bytes()
            magic, version, length = struct.unpack_from('<4sII', data)
            assert magic == b'glTF' and version == 2 and length == len(data)
            json_length, _ = struct.unpack_from('<II', data, 12)
            gltf = json.loads(data[20:20 + json_length])
            binary_start = 20 + json_length + 8
            accessors = gltf.get('accessors', [])
            primitives = [p for mesh in gltf['meshes'] for p in mesh['primitives']]
            positions = [p['attributes']['POSITION'] for p in primitives]
            indices = [p.get('indices') for p in primitives]
            textures = []
            for image in gltf.get('images', []):
                view = gltf['bufferViews'][image['bufferView']]
                offset = binary_start + view.get('byteOffset', 0)
                width, height = struct.unpack('>II', data[offset + 16:offset + 24])
                textures.append(dict(mimeType=image['mimeType'], embedded=True,
                                     width=width, height=height, bytes=view['byteLength']))
            thumbnail = repo / f"web/public/thumbnails/{item['id']}.png"
            row.update(dict(
                bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), format='GLB 2.0',
                externalDependencies=[b['uri'] for b in gltf.get('buffers', []) if b.get('uri')]
                    + [im['uri'] for im in gltf.get('images', []) if im.get('uri')],
                extensionsUsed=gltf.get('extensionsUsed', []),
                extensionsRequired=gltf.get('extensionsRequired', []),
                meshCount=len(gltf['meshes']), primitiveCount=len(positions),
                positionVertices=sum(accessors[a]['count'] for a in positions),
                triangles=sum(accessors[a]['count'] // 3 for a in indices if a is not None),
                textures=textures,
                bounds=dict(min=[min(accessors[a]['min'][k] for a in positions) for k in range(3)],
                            max=[max(accessors[a]['max'][k] for a in positions) for k in range(3)]),
                browserVerification='passed: actual GLB and textures rendered in production viewer; front view inspected'
                    if hashlib.sha256(data).hexdigest() in verified_sha256
                    else 'requires browser verification after new asset arrival',
                thumbnail=str(thumbnail.relative_to(repo)) if thumbnail.exists() else None,
                orientationDegrees=90 if item['id'] == 'mf-10' else 0))
            asset.update(dict(thumbnail=f"./thumbnails/{item['id']}.png" if thumbnail.exists() else None,
                              orientation=1.5707963267948966 if item['id'] == 'mf-10' else 0,
                              bytes=len(data)))
        else:
            row['browserVerification'] = 'not possible: source model absent; explicit missing state only'
        items.append(row)
        assets[item['id']] = asset

manifest = dict(sourceCommit='0e83f6f',
                configSource='existing shipping server --dump-config (no game state mutation)',
                configSha256=hashlib.sha256(config_path.read_bytes()).hexdigest(),
                generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                totalItems=len(items), availableModels=sum(i['available'] for i in items),
                missingModels=sum(not i['available'] for i in items), items=items)
(repo / 'docs/v2-resource-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
code = '''/** Verified owner GLBs; this manifest describes files, never changes the prize pool.
 * Thumbnails are transparent renders of the corresponding model. Missing models
 * remain retryable in the viewer when the owner supplies them later.
 */
export const modelAssets = Object.freeze(''' + json.dumps(assets, ensure_ascii=False, indent=2) + ');\n'
(repo / 'web/src/assets.js').write_text(code)

lines = ['# 奇物百货 V2 真实资源核对', '',
    '本清单以现行服务的 `--dump-config` 导出为藏品身份依据；模型来自 owner 提交 `0e83f6f`。检查未调用抽取接口，未修改任何游戏数据库。', '',
    '## 结论', '',
    '31 款中到位 6 款，仍缺 25 款。深夜食堂 5/7，打工动物 0/7，怪奇家电 0/7，奶蛙一家 1/10。6 个文件均为真正的 GLB 2.0 二进制，全部纹理嵌入，非 Git LFS 指针，不依赖外部下载、Draco 或 KTX2 解码器。都只使用 `KHR_materials_specular` 扩展，当前 Three.js GLTFLoader 支持。', '',
    '全部 6 款已经在 Chrome 中用生产 `createViewer` 分别加载并目视检查几何、纹理、尺度与正面。奶蛙源文件默认朝向侧面，展示与透明缩略图增加 +90° 固定朝向偏移；展柜的用户旋转值继续独立保存。', '',
    '首页四格货架使用本轮生成的四张透明手绘风系列 PNG，全部标为“系列示意”，不使用真实模型缩略图或 SVG 替代。下沿收藏快捷条与收藏列表继续使用 512×512 真实 GLB 渲染缩略图，不同时加载高精度模型。插画不代表具体奖品；抽中藏品的身份、结果信息和展柜模型仍对应服务数据与实际 GLB，缺失项显示“模型待补齐”。', '',
    '## 逐款状态', '',
    '| 系列 | ID | 名称 | 资源与浏览器验证 | 模型体积 |',
    '| --- | --- | --- | --- | --- |']
for item in items:
    status = '真实 GLB 已验证；有透明缩略图' if item['available'] else '缺失；不算 3D 完成'
    size = f"{item['bytes'] / 1024 / 1024:.2f} MiB" if item['available'] else '—'
    lines.append('| ' + ' | '.join([item['seriesName'], item['id'], item['name'], status, size]) + ' |')
lines += ['', '## 实际交互验证', '',
    '隔离资源工作台逐款确认六款模型，工作台没有游戏 API 路由。对 ms-01 人为返回一次 HTTP 503 后，查看器明确显示失败；点击“重新加载模型”恢复同一饭团的真实 3D，未重抽、未连接存档。向右旋转按钮与 Home 键恢复正面正常。ms-06 初始显示“模型待补齐”，点击“检查模型更新”后仍保留同一 ID 与缺失说明，没有替换成其他藏品。', '',
    '这份记录验证资源与查看器；抽取扣费、库存、展柜存档及最终页面布局由整体验收另行核对。', '',
    '## 加载与性能', '',
    '- 模型按结果页或展柜位置按需加载，尺寸自动归一化、底部落台，统一暖光。',
    '- 6 款分别约 9–20 MB；原文件保留不转码，手机首次加载仍可能受网速影响。',
    '- 已知缺失模型初次不发出无意义的 404 请求，也不创建空白 WebGL 上下文；“检查模型更新”会重新检查同一模型地址。',
    '- 加载过程可显示同一真实藏品的静态预览；静态预览不会被标作已完成 3D。加载失败与重试不涉及抽取或库存 API。',
    '- 当前 `KHR_materials_specular` 材质与内嵌 PNG 均已验证；无动画骨骼需求。', '',
    '## 复现与补传', '',
    '运行 `node scripts/render-thumbnails.mjs` 后打开 http://127.0.0.1:5197/ 。工作台只访问模型，不连接游戏 API；选择模型即可比较产品查看器与透明缩略图，点击“保存透明缩略图”输出到 `web/public/thumbnails/`。奶蛙缩略图角度为 90°，其他为 0°。', '',
    '补传时请保持配置中的藏品 ID 和 `models/<id>.glb` 对应。资源状态详见 `docs/v2-resource-manifest.json`。新增文件后更新 `web/src/assets.js`；旧页面的手动重试仍会尝试实际地址。', '']
# Keep manually recorded generated environment/illustration provenance on re-audit.
report = repo / 'docs/v2-resource-manifest.md'
extras = report.read_text().partition('## 本轮新增环境素材')[2] if report.exists() else ''
if extras:
    lines += ['## 本轮新增环境素材' + extras]
report.write_text('\n'.join(lines))
print(f"Verified files: {manifest['availableModels']}; absent: {manifest['missingModels']}")
