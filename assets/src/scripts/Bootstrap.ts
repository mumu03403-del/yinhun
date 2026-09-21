/**
 * 入口组件：挂在场景 GameRoot 节点上。
 * 运行时确保存在 GameManager 并启动游戏（自包含构建 UI，无需手工拼场景）。
 */
import { _decorator, Component } from 'cc';
import { GameManager } from './GameManager';

const { ccclass } = _decorator;

@ccclass('Bootstrap')
export class Bootstrap extends Component {
  onLoad() {
    let gm = this.node.getComponent(GameManager);
    if (!gm) {
      gm = this.node.addComponent(GameManager);
    }
  }

  start() {
    const gm = this.node.getComponent(GameManager);
    if (gm) gm.setup();
  }
}
