import type { Reporter, File, Vitest } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

/**
 * Custom Vitest reporter that splits test results into multiple JSON files
 * by project (unit, integration, e2e) and generates summary files
 */
export default class SplitJsonReporter implements Reporter {
  ctx!: Vitest;
  private results = new Map<string, File[]>();

  onInit(ctx: Vitest) {
    this.ctx = ctx;
  }

  async onFinished(files?: File[]) {
    if (!files) return;

    const outputDir = join(process.cwd(), 'test-results');
    await mkdir(outputDir, { recursive: true });

    // Group files by project
    const projectResults = new Map<string, File[]>();
    const failedTests: any[] = [];
    const summary = {
      numTotalTestSuites: 0,
      numPassedTestSuites: 0,
      numFailedTestSuites: 0,
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      startTime: Date.now(),
      success: true,
      projects: {} as Record<string, any>,
    };

    for (const file of files) {
      const projectName = (file.projectName as string) || 'default';

      if (!projectResults.has(projectName)) {
        projectResults.set(projectName, []);
      }
      projectResults.get(projectName)!.push(file);

      // Update summary
      summary.numTotalTestSuites++;
      const allTasks = this.getAllTasks(file);
      const failedTasks = allTasks.filter((t) => t.result?.state === 'fail');

      if (failedTasks.length > 0) {
        summary.numFailedTestSuites++;
        summary.success = false;

        // Collect failed test details
        failedTasks.forEach((task) => {
          failedTests.push({
            project: projectName,
            file: file.filepath,
            suite: task.suite?.name,
            test: task.name,
            error: task.result?.errors?.[0]?.message,
            duration: task.result?.duration,
          });
        });
      } else {
        summary.numPassedTestSuites++;
      }

      summary.numTotalTests += allTasks.length;
      summary.numPassedTests += allTasks.filter((t) => t.result?.state === 'pass').length;
      summary.numFailedTests += failedTasks.length;
    }

    // Write per-project JSON files
    for (const [projectName, projectFiles] of projectResults.entries()) {
      const projectData = {
        project: projectName,
        numTestSuites: projectFiles.length,
        numPassedTestSuites: projectFiles.filter((f) => {
          const tasks = this.getAllTasks(f);
          return tasks.every((t) => t.result?.state === 'pass');
        }).length,
        numFailedTestSuites: projectFiles.filter((f) => {
          const tasks = this.getAllTasks(f);
          return tasks.some((t) => t.result?.state === 'fail');
        }).length,
        testSuites: projectFiles.map((file) => ({
          name: file.filepath,
          status: this.getFileStatus(file),
          duration: file.result?.duration || 0,
          tests: this.getAllTasks(file).map((task) => ({
            name: task.name,
            status: task.result?.state || 'unknown',
            duration: task.result?.duration || 0,
            errors: task.result?.errors?.map((e) => ({
              message: e.message,
              stack: e.stack,
            })),
          })),
        })),
      };

      // Calculate project summary
      summary.projects[projectName] = {
        total: projectFiles.length,
        passed: projectData.numPassedTestSuites,
        failed: projectData.numFailedTestSuites,
      };

      await writeFile(
        join(outputDir, `${projectName}-tests.json`),
        JSON.stringify(projectData, null, 2),
        'utf-8',
      );
    }

    // Write summary file
    await writeFile(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

    // Write failed tests file (only if there are failures)
    if (failedTests.length > 0) {
      await writeFile(
        join(outputDir, 'failed-tests.json'),
        JSON.stringify({ numFailedTests: failedTests.length, failures: failedTests }, null, 2),
        'utf-8',
      );
    }

    // Write passed tests summary
    const passedSummary = {
      numPassedTests: summary.numPassedTests,
      numPassedTestSuites: summary.numPassedTestSuites,
      projects: Object.entries(summary.projects).map(([name, stats]) => ({
        name,
        passed: (stats as any).passed,
      })),
    };

    await writeFile(
      join(outputDir, 'passed-tests-summary.json'),
      JSON.stringify(passedSummary, null, 2),
      'utf-8',
    );

    // Write pointer file at test-results.json location
    const pointerContent = {
      message:
        'Test results have been split into multiple files for better performance and readability.',
      location: './test-results/',
      files: {
        'summary.json': 'High-level overview with totals and project breakdowns',
        'unit-tests.json': 'All unit test results',
        'integration-tests.json': 'All integration test results',
        'e2e-tests.json': 'All end-to-end test results',
        'failed-tests.json': 'Detailed failure information (only present if tests failed)',
        'passed-tests-summary.json': 'Summary of passed tests',
        'index.html': 'Interactive HTML report (open in browser)',
      },
      quickStats: {
        total: summary.numTotalTests,
        passed: summary.numPassedTests,
        failed: summary.numFailedTests,
        success: summary.success,
      },
      note: 'For detailed results, see the files in the test-results/ directory.',
    };

    await writeFile(
      join(process.cwd(), 'test-results.json'),
      JSON.stringify(pointerContent, null, 2),
      'utf-8',
    );

    console.log('\n📊 Test results written to test-results/');
    console.log(`   - summary.json (overview)`);
    console.log(`   - *-tests.json (${projectResults.size} project file(s))`);
    if (failedTests.length > 0) {
      console.log(`   - failed-tests.json (${failedTests.length} failure(s))`);
    }
    console.log(`   - passed-tests-summary.json`);
    console.log(`   - index.html (interactive report)`);
    console.log(`\n💡 test-results.json contains a pointer to the detailed results`);
  }

  private getAllTasks(file: File): any[] {
    const tasks: any[] = [];

    const collectTasks = (suite: any) => {
      if (suite.tasks) {
        for (const task of suite.tasks) {
          if (task.type === 'test') {
            tasks.push(task);
          } else if (task.type === 'suite') {
            collectTasks(task);
          }
        }
      }
    };

    collectTasks(file);
    return tasks;
  }

  private getFileStatus(file: File): string {
    const tasks = this.getAllTasks(file);
    if (tasks.some((t) => t.result?.state === 'fail')) return 'failed';
    if (tasks.every((t) => t.result?.state === 'pass')) return 'passed';
    return 'unknown';
  }
}
