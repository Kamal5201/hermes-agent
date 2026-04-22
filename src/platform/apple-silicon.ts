/**
 * Apple Silicon (M1/M2/M3/M4) Support
 * 
 * Hermes Companion - Apple Silicon Mac 支持
 * 优化 ARM64 架构性能
 */

import { execSync } from 'child_process';

// 检测 Apple Silicon
export function isAppleSilicon(): boolean {
  try {
    const result = execSync('uname -m', { encoding: 'utf8' });
    return result.trim() === 'arm64';
  } catch {
    return false;
  }
}

// 获取芯片类型
export function getChipInfo(): { chip: string; cores: number } {
  try {
    const chip = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' }).trim();
    const cores = parseInt(execSync('sysctl -n hw.perflevel0.physicalcpu', { encoding: 'utf8' }).trim() || '1', 10);
    return { chip, cores };
  } catch {
    return { chip: 'Apple Silicon', cores: 8 };
  }
}

// ARM64 优化配置
export const ARM64_CONFIG = {
  // Electron 构建配置
  electron: {
    arm64: true,
    x64: false, // 不需要 Rosetta
    target: 'macOS-arm64',
  },
  
  // 原生模块构建
  nativeModules: {
    // better-sqlite3 需要特殊处理
    betterSqlite3: {
      rebuildArm64: true,
      runtime: 'node-napi',
    },
    
    // node-pty 需要 ARM 版本
    nodePty: {
      platform: 'darwin',
      arch: 'arm64',
    },
    
    // nut-js 应该是跨平台的
    nutJs: {
      native: true,
    },
  },
  
  // 性能优化
  performance: {
    // 使用 Apple GPU 加速
    useMetalGpu: true,
    
    // 启用 Core ML 加速 (如果可用)
    useCoreML: true,
    
    // 内存优化 - Apple Silicon 共享内存
    optimizeMemory: true,
  },
};

// Rosetta 2 检测 (是否在使用转译层)
export function isUsingRosetta(): boolean {
  try {
    const result = execSync('sysctl -n sysctl.proc_translated', { encoding: 'utf8' }).trim();
    return result === '1';
  } catch {
    return false;
  }
}

// 通用二进制检测
export function isUniversalBinary(binaryPath: string): boolean {
  try {
    const result = execSync(`file "${binaryPath}"`, { encoding: 'utf8' });
    return result.includes('universal');
  } catch {
    return false;
  }
}

// 构建 ARM64 版本的 package.json 配置
export const MACOS_ARM64_PACKAGE = {
  // electron-builder mac 配置
  mac: {
    category: 'public.app-category.productivity',
    target: [
      {
        name: 'macOS ARM64',
        platform: 'macos',
        arch: 'arm64',
      },
    ],
    artifactName: '${productName}-${version}-macOS-ARM64.${ext}',
  },
  
  // DMG 配置
  dmg: {
    architectures: ['arm64'],
  },
};

// 推荐的构建命令
export const BUILD_COMMANDS = {
  // 本地 ARM Mac 构建
  localArmBuild: 'npm run build:mac -- --mac.arm64',
  
  // 交叉编译 (Intel Mac -> ARM Mac)
  crossCompile: 'npm run build:mac -- --mac universal',
  
  // CI/CD 多平台构建
  ciBuild: [
    'npm run build:mac -- --mac arm64',
    'npm run build:mac -- --mac x64',
  ],
};

export default {
  isAppleSilicon,
  getChipInfo,
  isUsingRosetta,
  isUniversalBinary,
  ARM64_CONFIG,
  MACOS_ARM64_PACKAGE,
  BUILD_COMMANDS,
};
