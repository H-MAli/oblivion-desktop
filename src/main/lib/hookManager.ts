import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import settings from 'electron-settings';
import log from 'electron-log';

export type HookType = 'connectSuccess' | 'connectFail' | 'disconnect' | 'connectionError';

interface HookConfig {
    executable: string;
    args: string;
}

class HookManager {
    /**
     * Execute a hook by type
     */
    public static async executeHook(hookType: HookType, context?: Record<string, any>): Promise<void> {
        try {
            const hookConfig = await this.getHookConfig(hookType);
            if (!hookConfig.executable) {
                log.info(`No executable configured for hook: ${hookType}`);
                return;
            }

            await this.runHook(hookType, hookConfig, context);
        } catch (error) {
            log.error(`Error executing hook ${hookType}:`, error);
        }
    }

    /**
     * Get hook configuration from settings
     */
    private static async getHookConfig(hookType: HookType): Promise<HookConfig> {
        const executableKey = `hook${this.capitalizeFirst(hookType)}` as const;
        const argsKey = `hook${this.capitalizeFirst(hookType)}Args` as const;

        const executable = (await settings.get(executableKey)) || '';
        const args = (await settings.get(argsKey)) || '';

        return {
            executable: String(executable),
            args: String(args)
        };
    }

    /**
     * Run the hook executable
     */
    private static async runHook(hookType: HookType, config: HookConfig, context?: Record<string, any>): Promise<void> {
        // Validate executable exists
        if (!fs.existsSync(config.executable)) {
            log.error(`Hook executable not found: ${config.executable}`);
            return;
        }

        const executablePath = path.resolve(config.executable);
        const args = this.parseArguments(config.args);

        // Prepare environment variables with context information
        const env = { ...process.env };
        
        // Add hook type and timestamp
        env.OBLIVION_HOOK_TYPE = hookType;
        env.OBLIVION_TIMESTAMP = new Date().toISOString();
        
        // Add context information as environment variables
        if (context) {
            Object.entries(context).forEach(([key, value]) => {
                env[`OBLIVION_${key.toUpperCase()}`] = String(value);
            });
        }

        log.info(`Executing hook: ${hookType} - ${executablePath} ${args.join(' ')}`);

        try {
            const child = spawn(executablePath, args, {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                env
            });

            // Unref the child process so it doesn't keep the parent process alive
            child.unref();

            // Add timeout for hook execution (optional)
            const timeout = setTimeout(() => {
                if (!child.killed) {
                    log.warn(`Hook ${hookType} execution timeout, terminating...`);
                    child.kill();
                }
            }, 30000); // 30 second timeout

            child.on('spawn', () => {
                log.info(`Hook ${hookType} spawned successfully (PID: ${child.pid})`);
                clearTimeout(timeout);
            });

            child.on('error', (error) => {
                log.error(`Hook ${hookType} spawn error:`, error);
                clearTimeout(timeout);
            });

            child.on('exit', (code, signal) => {
                clearTimeout(timeout);
                if (code !== null) {
                    log.info(`Hook ${hookType} exited with code: ${code}`);
                } else if (signal) {
                    log.info(`Hook ${hookType} terminated by signal: ${signal}`);
                }
            });

        } catch (error) {
            log.error(`Failed to spawn hook ${hookType}:`, error);
        }
    }

    /**
     * Parse command line arguments string into array
     */
    private static parseArguments(argsString: string): string[] {
        if (!argsString.trim()) {
            return [];
        }

        // Simple argument parsing - splits on spaces but respects quoted strings
        const args: string[] = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < argsString.length; i++) {
            const char = argsString[i];

            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current.trim()) {
                    args.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            args.push(current.trim());
        }

        return args;
    }

    /**
     * Capitalize first letter
     */
    private static capitalizeFirst(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Test hook execution (for debugging)
     */
    public static async testHook(hookType: HookType): Promise<boolean> {
        try {
            const hookConfig = await this.getHookConfig(hookType);
            if (!hookConfig.executable) {
                log.info(`No executable configured for hook: ${hookType}`);
                return false;
            }

            if (!fs.existsSync(hookConfig.executable)) {
                log.error(`Hook executable not found: ${hookConfig.executable}`);
                return false;
            }

            log.info(`Hook ${hookType} configuration is valid: ${hookConfig.executable}`);
            return true;
        } catch (error) {
            log.error(`Error testing hook ${hookType}:`, error);
            return false;
        }
    }
}

export { HookManager };
