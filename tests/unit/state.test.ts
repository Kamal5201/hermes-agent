/**
 * Hermes Companion - StateEngine 单元测试
 * 
 * 测试状态机转换逻辑
 */

import { StateEngine, CompanionState } from '../../src/state/StateEngine';

describe('StateEngine', () => {
  let stateEngine: StateEngine;

  beforeEach(() => {
    stateEngine = new StateEngine(CompanionState.STEALTH);
  });

  describe('状态转换', () => {
    test('初始状态应该是 STEALTH', () => {
      expect(stateEngine.getCurrentState()).toBe(CompanionState.STEALTH);
    });

    test('应该能切换到 OBSERVING', () => {
      stateEngine.setState(CompanionState.OBSERVING);
      expect(stateEngine.getCurrentState()).toBe(CompanionState.OBSERVING);
    });

    test('应该能切换到 HINT', () => {
      stateEngine.setState(CompanionState.OBSERVING);
      stateEngine.setState(CompanionState.HINT);
      expect(stateEngine.getCurrentState()).toBe(CompanionState.HINT);
    });

    test('应该能切换到 ACTIVE', () => {
      stateEngine.setState(CompanionState.HINT);
      stateEngine.setState(CompanionState.ACTIVE);
      expect(stateEngine.getCurrentState()).toBe(CompanionState.ACTIVE);
    });

    test('应该能切换到 RETREATING', () => {
      stateEngine.setState(CompanionState.ACTIVE);
      stateEngine.setState(CompanionState.RETREATING);
      expect(stateEngine.getCurrentState()).toBe(CompanionState.RETREATING);
    });

    test('RETREATING 后应该回到 STEALTH', () => {
      stateEngine.setState(CompanionState.RETREATING);
      stateEngine.setState(CompanionState.STEALTH);
      expect(stateEngine.getCurrentState()).toBe(CompanionState.STEALTH);
    });
  });

  describe('上下文更新', () => {
    test('应该能更新上下文', () => {
      stateEngine.updateContext({
        userActivity: 1,
        attentionNeeded: true
      });
      
      const context = stateEngine.getContext();
      expect(context.userActivity).toBe(1);
      expect(context.attentionNeeded).toBe(true);
    });

    test('高用户活动应该触发状态变化', () => {
      stateEngine.updateContext({
        userActivity: 1,
        lastActivityTimestamp: Date.now()
      });
      
      // 状态机应该在高活动时进入 OBSERVING
      expect(stateEngine.getCurrentState()).not.toBe(CompanionState.STEALTH);
    });
  });

  describe('状态持续时间', () => {
    test('应该能获取状态持续时间', () => {
      stateEngine.setState(CompanionState.OBSERVING);
      
      // 等待一小段时间
      const startTime = Date.now();
      
      // 状态持续时间应该大于 0
      const duration = stateEngine.getStateDuration();
      expect(duration).toBeGreaterThan(0);
    });
  });

  describe('状态转换事件', () => {
    test('状态变化时应该触发事件', (done) => {
      stateEngine.onStateChange((newState, oldState) => {
        expect(newState).toBe(CompanionState.OBSERVING);
        expect(oldState).toBe(CompanionState.STEALTH);
        done();
      });
      
      stateEngine.setState(CompanionState.OBSERVING);
    });
  });
});
