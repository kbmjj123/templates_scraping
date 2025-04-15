import { execa } from 'execa';
import path from 'path';
import fs from 'fs/promises';

export class TechStackAnalyzer {
  static async analyze(repoPath: string) {
    const [pkg, dockerCompose] = await Promise.all([
      this.readPackageJson(repoPath),
      this.checkDockerCompose(repoPath),
    ]);
		const dependenciesInfo = await this.analyzeDependencies(repoPath);
    return {
      framework: await this.detectFramework(pkg, repoPath),
      database: await this.detectDatabase(dockerCompose, repoPath),
      requiredServices: await this.detectRequiredServices(repoPath),
      hasEnvExample: await this.checkEnvExample(repoPath),
      dependencies: dependenciesInfo.coreDependencies,
      devDependencies: dependenciesInfo.devDependencies,
      potentiallyOutdatedDependencies: dependenciesInfo.potentiallyOutdated,
    };
  }

  static async readPackageJson(repoPath: string) {
    try {
      const data = await fs.readFile(path.join(repoPath, 'package.json'), 'utf8');
      return JSON.parse(data);
    } catch {
      return { dependencies: {}, devDependencies: {}, scripts: {} };
    }
  }

	static async detectRequiredServices(repoPath: string) {
		const services: string[] = [];
	
		// 从 docker-compose.yml 检测
		const dockerCompose = await this.checkDockerCompose(repoPath);
		if (/postgres/.test(dockerCompose)) services.push('PostgreSQL');
		if (/mysql/.test(dockerCompose)) services.push('MySQL');
		if (/mongodb/.test(dockerCompose)) services.push('MongoDB');
		if (/redis/.test(dockerCompose)) services.push('Redis');
		if (/nginx/.test(dockerCompose)) services.push('Nginx');
		if (/elasticsearch/.test(dockerCompose)) services.push('Elasticsearch');
		if (/rabbitmq/.test(dockerCompose)) services.push('RabbitMQ');
	
		// 从 package.json 的 scripts 检测
		const pkg = await this.readPackageJson(repoPath);
		const scripts = pkg.scripts || {};
		const scriptValues = Object.values(scripts).join(' ').toLowerCase();
		if (scriptValues.includes('redis')) services.push('Redis');
		if (scriptValues.includes('nginx')) services.push('Nginx');
		if (scriptValues.includes('rabbitmq')) services.push('RabbitMQ');
	
		// 从 Dockerfile 检测
		try {
			const dockerfileContent = await fs.readFile(path.join(repoPath, 'Dockerfile'), 'utf8');
			if (/nginx/i.test(dockerfileContent)) services.push('Nginx');
			if (/redis/i.test(dockerfileContent)) services.push('Redis');
		} catch {
			// 如果没有 Dockerfile，继续
		}
	
		// 从 Kubernetes 文件检测
		try {
			const files = await fs.readdir(repoPath);
			const k8sFile = files.find(file => file.includes('k8s') && file.endsWith('.yaml'));
			if (k8sFile) {
				const k8sContent = await fs.readFile(path.join(repoPath, k8sFile), 'utf8');
				if (/postgres/i.test(k8sContent)) services.push('PostgreSQL');
				if (/redis/i.test(k8sContent)) services.push('Redis');
			}
		} catch {
			// 如果没有 Kubernetes 文件，继续
		}
	
		return services.length > 0 ? [...new Set(services)] : ['None']; // 去重
	}

  static async checkDockerCompose(repoPath: string) {
    const composePath = path.join(repoPath, 'docker-compose.yml');
    const exists = await this.checkFileExists(composePath);
    return exists ? await fs.readFile(composePath, 'utf8') : '';
  }

  static async detectFramework(pkg: any, repoPath: string) {
		const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
	
		if (dependencies.next) return 'Next.js';
		if (dependencies.nuxt) return 'Nuxt.js';
		if (dependencies.sveltekit) return 'SvelteKit';
		if (dependencies.react) return 'React';
		if (dependencies.vue) return 'Vue';
		if (dependencies['@angular/core']) return 'Angular';
		if (dependencies.express) return 'Express';
		if (dependencies.ember) return 'Ember';
	
		// 文件结构辅助检测
		try {
			const files = await fs.readdir(repoPath);
			if (files.includes('src') && (await fs.readdir(path.join(repoPath, 'src'))).includes('app')) {
				return 'Next.js'; // Next.js 典型目录结构
			}
			if (files.includes('angular.json')) {
				return 'Angular';
			}
			if (files.includes('nuxt.config.js') || files.includes('nuxt.config.ts')) {
				return 'Nuxt.js';
			}
		} catch {
			// 如果文件结构检测失败，继续使用默认值
		}
	
		return 'Unknown';
	}

  static async detectDatabase(dockerCompose: string, repoPath: string) {
		// 从 docker-compose.yml 检测
		if (/postgres/.test(dockerCompose)) return 'PostgreSQL';
		if (/mysql/.test(dockerCompose)) return 'MySQL';
		if (/mongodb/.test(dockerCompose)) return 'MongoDB';
		if (/redis/.test(dockerCompose)) return 'Redis';
		if (/mariadb/.test(dockerCompose)) return 'MariaDB';
	
		// 从 package.json 检测
		const pkg = await this.readPackageJson(repoPath);
		const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
		if (dependencies.pg) return 'PostgreSQL';
		if (dependencies.mysql || dependencies.mysql2) return 'MySQL';
		if (dependencies.mongodb || dependencies.mongoose) return 'MongoDB';
		if (dependencies.redis) return 'Redis';
		if (dependencies.sqlite3) return 'SQLite';
	
		// 从 .env 文件检测
		const envFiles = ['.env', '.env.example', '.env.sample', 'example.env'];
		for (const envFile of envFiles) {
			try {
				const envContent = await fs.readFile(path.join(repoPath, envFile), 'utf8');
				if (/postgres/i.test(envContent)) return 'PostgreSQL';
				if (/mysql/i.test(envContent)) return 'MySQL';
				if (/mongo/i.test(envContent)) return 'MongoDB';
				if (/redis/i.test(envContent)) return 'Redis';
				if (/sqlite/i.test(envContent)) return 'SQLite';
			} catch {
				continue;
			}
		}
	
		return 'None';
	}

	static async analyzeDependencies(repoPath: string) {
		const pkg = await this.readPackageJson(repoPath);
		const dependencies = Object.keys(pkg.dependencies || {});
		const devDependencies = Object.keys(pkg.devDependencies || {});
	
		return {
			coreDependencies: dependencies,
			devDependencies: devDependencies,
			// 简单标记潜在过时依赖（示例：版本号以 0.x 开头可能不稳定）
			potentiallyOutdated: dependencies.filter(dep => {
				const version = pkg.dependencies[dep];
				return version && (version.startsWith('0.') || version.includes('beta'));
			}),
		};
	}

	static async checkEnvExample(repoPath: string) {
		const envFiles = ['.env.example', '.env.sample', 'example.env'];
		for (const envFile of envFiles) {
			if (await this.checkFileExists(path.join(repoPath, envFile))) {
				return true;
			}
		}
		return false;
	}

  static async checkFileExists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}