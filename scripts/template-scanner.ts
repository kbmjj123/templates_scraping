import 'dotenv/config';
import { Queue } from '../lib/queue.js';
import { GitHubScanner } from '../lib/processors/github.js';
import { TechStackAnalyzer } from '../lib/processors/tech-stack.js';
import { RiskEvaluator } from '../lib/processors/risk.js';
import fs from 'fs/promises';
import path from 'path';
import { Database } from '../lib/db.js';
import dotenv from 'dotenv';

dotenv.config({
	path: '.env.local',
});

class TemplateScanner {
	queue: Queue;
	db = new Database();

	constructor() {
		if (!process.env.REDIS_URL) {
			throw new Error('REDIS_URL must be set in environment variables');
		}
		this.queue = new Queue(process.env.REDIS_URL);
	}

	async start() {
		const templates = await this.db.query<{ id: number; visit_link: string }>();
		console.log('待处理模板:', templates.rows);

		for (const template of templates.rows) {
			await this.queue.add('scan-template', template, {
				attempts: 3,
				backoff: { type: 'exponential', delay: 5000 },
			});
		}

		console.log(`已添加 ${templates.rows.length} 个模板扫描任务`);
	}

	async processJob(job: any) {
		console.info('开始模版任务', job.data);
		const { id, visit_link } = job.data;
		let clonePath: string | null = null;
		if (!visit_link.includes('github.com')) {
			console.info('不是github仓库，跳过');
			return;
		}
		try {
			clonePath = await GitHubScanner.cloneRepo(visit_link);
			const [techStack, githubStats] = await Promise.all([
				TechStackAnalyzer.analyze(clonePath),
				GitHubScanner.fetchRepoStats(visit_link),
			]);
	
			// 统计代码行数 (LOC)
			const loc = await this.calculateLOC(clonePath);
	
			// 从 README.md 提取核心功能
			const coreFeatures = await this.extractCoreFeatures(clonePath);
	
			// 从 docker-compose.yml 或 package.json 提取所需服务
			const requiredServices = await TechStackAnalyzer.detectRequiredServices(clonePath);
	
			// 获取贡献者数量
			const contributors = await GitHubScanner.fetchContributorsCount(visit_link);
	
			// 计算风险评分
			const risk = RiskEvaluator.evaluate({
				...githubStats,
				hasEnvExample: techStack.hasEnvExample,
				dependencies: techStack.dependencies,
				contributors,
				openIssues: githubStats.openIssues,
				loc,
				license: githubStats.license || 'None',
			});
	
			// 计算自定义分数
			const customScore = this.calculateCustomScore(
				githubStats.stars,
				contributors,
				coreFeatures,
				techStack.hasEnvExample,
				githubStats.lastCommit,
				risk.score
			);
	
			// 提取主题颜色（简单实现，假设从 CSS 文件提取）
			const themeColors = await this.extractThemeColors(clonePath);
	
			// 记录当前扫描时间
			const lastScanned = new Date();
	
			// 更新数据库
			await this.db.updateTemplate(id, {
				tech_stack: {
					framework: techStack.framework,
					database: techStack.database,
					required_services: techStack.requiredServices,
					dependencies: techStack.dependencies,
					dev_dependencies: techStack.devDependencies,
					potentially_outdated: techStack.potentiallyOutdatedDependencies,
				},
				stars: githubStats.stars,
				forks: githubStats.forks,
				last_commit: new Date(githubStats.lastCommit),
				risk_score: risk.score,
				has_env_example: techStack.hasEnvExample,
				open_issues: githubStats.openIssues,
				license: githubStats.license || 'None',
				core_features: coreFeatures,
				required_services: requiredServices,
				custom_score: customScore,
				theme_colors: themeColors,
				loc: loc,
				contributors: contributors,
				last_scanned: lastScanned,
			});
	
			console.log(`模板 ${id} 更新成功`);
		} catch (error: any) {
			console.error(`模板 ${id} 处理失败:`, error.message);
			throw error;
		} finally {
			if (clonePath) {
				await GitHubScanner.cleanup(clonePath);
			}
		}
	}

	// 统计代码行数 (LOC)
	async calculateLOC(repoPath: string) {
		let loc = 0;
		const files = await this.walkDir(repoPath);
	
		// 支持的代码文件扩展名（可扩展）
		const codeExtensions = new Set([
			'.js', '.ts', '.jsx', '.tsx', // JavaScript/TypeScript
			'.py', // Python
			'.go', // Go
			'.java', // Java
			'.rb', // Ruby
			'.php', // PHP
			'.c', '.cpp', '.h', // C/C++
			'.rs', // Rust
			'.html', '.css', '.scss', // 标记和样式
		]);
	
		for (const file of files) {
			const ext = path.extname(file).toLowerCase();
			if (codeExtensions.has(ext)) {
				const content = await fs.readFile(file, 'utf8');
				const lines = content.split('\n').filter(line => {
					const trimmed = line.trim();
					// 忽略空行和常见注释
					return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('<!--');
				});
				loc += lines.length;
			}
		}
		return loc;
	}
	
	async walkDir(dir: string): Promise<string[]> {
		const files: string[] = [];
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			// 排除无关目录
			if (entry.isDirectory() && (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build')) {
				continue;
			}
			if (entry.isDirectory()) {
				files.push(...await this.walkDir(fullPath));
			} else {
				files.push(fullPath);
			}
		}
		return files;
	}
	// 提取核心功能
	async extractCoreFeatures(repoPath: string) {
		const readmePath = path.join(repoPath, 'README.md');
		let features: string[] = [];
	
		// 尝试读取 README.md
		try {
			const readmeContent = await fs.readFile(readmePath, 'utf8');
			features = this.parseReadmeForFeatures(readmeContent);
		} catch {
			console.info(`模板 ${repoPath} 无 README.md，尝试回退到 package.json`);
		}
	
		// 如果 README.md 解析失败或无有效特征，回退到 package.json
		if (features.length === 0) {
			const packageJsonPath = path.join(repoPath, 'package.json');
			try {
				const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
				if (pkg.description) {
					features = [pkg.description];
				}
			} catch {
				console.info(`模板 ${repoPath} 无 package.json 或 description`);
			}
		}
	
		return features.length > 0 ? features : ['Unknown'];
	}
	
	parseReadmeForFeatures(readmeContent: string): string[] {
		const lines = readmeContent.split('\n');
		const features: string[] = [];
		let inFeaturesSection = false;
	
		for (const line of lines) {
			const trimmedLine = line.trim();
	
			// 查找 "Features" 或 "功能" 相关的标题
			if (trimmedLine.startsWith('##')) {
				const heading = trimmedLine.replace(/^##+\s*/, '').toLowerCase();
				inFeaturesSection = heading.includes('features') || heading.includes('功能') || heading.includes('特性');
				continue;
			}
	
			// 如果在 Features 部分，提取列表项
			if (inFeaturesSection && (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* '))) {
				const feature = trimmedLine.replace(/^[-*]\s*/, '').trim();
				if (feature && features.length < 5) { // 限制最多提取 5 个功能
					features.push(feature);
				}
			}
	
			// 如果遇到下一个标题，退出 Features 部分
			if (inFeaturesSection && trimmedLine.startsWith('#')) {
				break;
			}
		}
	
		// 如果没有找到 Features 部分，尝试从全局提取前几个列表项
		if (features.length === 0) {
			for (const line of lines) {
				const trimmedLine = line.trim();
				if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
					const feature = trimmedLine.replace(/^[-*]\s*/, '').trim();
					if (feature && features.length < 3) { // 限制最多提取 3 个功能
						features.push(feature);
					}
				}
			}
		}
		return features;
	}
	// 计算自定义分数
	calculateCustomScore(
		stars: number,
		contributors: number,
		coreFeatures: string[],
		hasEnvExample: boolean,
		lastCommit: string,
		riskScore: number
	) {
		// 流行度和社区支持
		const starsScore = Math.min(stars / 5000, 1); // 标准化 stars（上限 5000）
		const contributorsScore = Math.min(contributors / 50, 1); // 标准化 contributors（上限 50）
	
		// 功能完整性
		const featuresScore = Math.min(coreFeatures.length / 5, 1); // 标准化 core_features 数量（上限 5）
		const envScore = hasEnvExample ? 1 : 0;
	
		// 维护活跃度
		const monthsInactive = (Date.now() - new Date(lastCommit).getTime()) / (30 * 86400e3);
		let lastCommitScore = 0;
		if (monthsInactive <= 3) {
			lastCommitScore = 1; // 最近 3 个月
		} else if (monthsInactive <= 6) {
			lastCommitScore = 0.5; // 最近 6 个月
		}
	
		// 风险调整
		const riskAdjustment = 1 - riskScore / 5; // 风险越低，分数越高
	
		// 综合计算（范围 0-5）
		const customScore =
			(starsScore * 0.25 +
				contributorsScore * 0.15 +
				featuresScore * 0.2 +
				envScore * 0.1 +
				lastCommitScore * 0.2 +
				riskAdjustment * 0.1) *
			5;
	
		return Math.round(customScore * 10) / 10; // 保留 1 位小数
	}
	// 提取主题颜色
	async extractThemeColors(repoPath: string) {
		// 简单实现：查找 CSS 文件并提取颜色（这里仅为示例）
		const cssFiles = (await this.walkDir(repoPath)).filter(file => file.endsWith('.css'));
		const colors = [];
		for (const file of cssFiles) {
			const content = await fs.readFile(file, 'utf8');
			const colorMatches = content.match(/#[0-9a-fA-F]{6}/g); // 匹配 HEX 颜色
			if (colorMatches) {
				colors.push(...colorMatches.slice(0, 2)); // 取前两个颜色
			}
		}
		return colors.length > 0 ? colors : ['#3b82f6', '#1e293b']; // 默认颜色
	}
}

const scanner = new TemplateScanner();

if (process.argv.includes('--worker')) {
	scanner.queue.setupWorker(async (job) => {
		await scanner.processJob(job);
	});
	console.log('Worker 已启动，等待任务...');
} else {
	scanner.start();
}