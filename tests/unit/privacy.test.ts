/**
 * Hermes Companion - PrivacyManager 单元测试
 * 
 * 测试隐私保护功能
 */

import {
  PrivacyManager,
  PrivacyLevel,
  type Operation
} from '../../src/security/PrivacyManager';

describe('PrivacyManager', () => {
  let privacyManager: PrivacyManager;

  beforeEach(() => {
    // 每个测试前重置单例
    PrivacyManager.resetInstance();
    privacyManager = PrivacyManager.getInstance();
  });

  describe('三档隐私预设', () => {
    test('默认级别应该是 BALANCED', () => {
      expect(privacyManager.getPrivacyLevel()).toBe(PrivacyLevel.BALANCED);
    });

    test('应该能切换到 CONSERVATIVE', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.CONSERVATIVE);
      expect(privacyManager.getPrivacyLevel()).toBe(PrivacyLevel.CONSERVATIVE);
    });

    test('应该能切换到 FULL', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.FULL);
      expect(privacyManager.getPrivacyLevel()).toBe(PrivacyLevel.FULL);
    });

    test('应该返回所有预设', () => {
      const presets = privacyManager.getPrivacyPresets();
      expect(presets).toHaveLength(3);
      expect(presets[0].level).toBe(PrivacyLevel.CONSERVATIVE);
      expect(presets[1].level).toBe(PrivacyLevel.BALANCED);
      expect(presets[2].level).toBe(PrivacyLevel.FULL);
    });
  });

  describe('敏感应用过滤', () => {
    test('应该拦截 Safari', () => {
      const operation: Operation = { appName: 'Safari' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });

    test('应该拦截 Chrome', () => {
      const operation: Operation = { appName: 'Chrome' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });

    test('应该拦截 Messages', () => {
      const operation: Operation = { appName: 'Messages' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });

    test('应该拦截 1Password', () => {
      const operation: Operation = { appName: '1Password' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });

    test('应该允许普通应用', () => {
      const operation: Operation = { appName: 'Visual Studio Code' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(true);
    });
  });

  describe('隐私模式开关', () => {
    test('开启隐私模式后应该拒绝所有记录', () => {
      privacyManager.setPrivacyMode(true);
      const operation: Operation = { appName: 'Visual Studio Code' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });

    test('关闭隐私模式后应该恢复正常', () => {
      privacyManager.setPrivacyMode(false);
      const operation: Operation = { appName: 'Visual Studio Code' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(true);
    });
  });

  describe('应用屏蔽', () => {
    test('应该能屏蔽指定应用', () => {
      privacyManager.blockApp('com.example.app');
      expect(privacyManager.isAppBlocked('com.example.app')).toBe(true);
    });

    test('应该能取消屏蔽应用', () => {
      privacyManager.blockApp('com.example.app');
      privacyManager.unblockApp('com.example.app');
      expect(privacyManager.isAppBlocked('com.example.app')).toBe(false);
    });

    test('屏蔽的应用应该被拒绝', () => {
      privacyManager.blockApp('com.example.app');
      const operation: Operation = { bundleId: 'com.example.app' };
      expect(privacyManager.shouldRecordOperation(operation)).toBe(false);
    });
  });

  describe('数据类型权限', () => {
    test('CONSERVATIVE 模式不能使用 window_title', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.CONSERVATIVE);
      expect(privacyManager.canUseData('window_title')).toBe(false);
    });

    test('BALANCED 模式可以使用 window_title', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.BALANCED);
      expect(privacyManager.canUseData('window_title')).toBe(true);
    });

    test('FULL 模式可以使用 prediction', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.FULL);
      expect(privacyManager.canUseData('prediction')).toBe(true);
    });

    test('CONSERVATIVE 模式不能使用 prediction', () => {
      privacyManager.setPrivacyLevel(PrivacyLevel.CONSERVATIVE);
      expect(privacyManager.canUseData('prediction')).toBe(false);
    });
  });
});
