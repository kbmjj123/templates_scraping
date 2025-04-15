export class RiskEvaluator {
  static evaluate({
    stars,
    lastCommit,
    hasEnvExample,
    dependencies,
    contributors,
    openIssues,
    loc,
    license,
  }: {
    stars: number;
    lastCommit: string;
    hasEnvExample: boolean;
    dependencies: string[];
    contributors: number;
    openIssues: number;
    loc: number;
    license: string | null;
  }) {
    const factors: string[] = [];
    let score = 0;

    // 社区活跃度
    if (stars < 100) {
      score += 1.5;
      factors.push('低关注度（Stars < 100）');
    }
    if (contributors < 3) {
      score += 1;
      factors.push('贡献者过少（< 3）');
    }

    // 维护情况
    const monthsInactive = (Date.now() - new Date(lastCommit).getTime()) / (30 * 86400e3);
    if (monthsInactive > 12) {
      score += 2;
      factors.push('超过12个月未更新');
    } else if (monthsInactive > 6) {
      score += 1;
      factors.push('超过6个月未更新');
    }
    if (openIssues > 50) {
      score += 1;
      factors.push('未解决Issue过多（> 50）');
    }

    // 代码复杂度
    if (loc > 10000) {
      score += 1;
      factors.push('代码量过大（LOC > 10,000）');
    }
    if (dependencies.length > 50) {
      score += 0.5;
      factors.push('依赖过多（> 50）');
    }

    // 配置规范
    if (!hasEnvExample) {
      score += 0.5;
      factors.push('缺少环境变量示例');
    }
    if (!license || license === 'None') {
      score += 0.5;
      factors.push('缺少许可证');
    }

    return { score: Math.min(score, 5), factors };
  }
}