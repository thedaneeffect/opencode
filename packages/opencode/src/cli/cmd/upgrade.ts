import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { $ } from "bun"
import fs from "fs"

// @ts-ignore - defined at compile time
const BUILD_SOURCE_DIR = typeof OPENCODE_BUILD_SOURCE !== "undefined" ? OPENCODE_BUILD_SOURCE : undefined

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "upgrade opencode to the latest or a specific version",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "version to upgrade to, for ex '0.1.48' or 'v0.1.48'",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "installation method to use",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew"],
      })
      .option("sync", {
        alias: "s",
        describe: "sync with upstream before rebuilding (dev builds only)",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args: { target?: string; method?: string; sync?: boolean }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    // If this is a development build, use rebuild instead
    if (BUILD_SOURCE_DIR && fs.existsSync(BUILD_SOURCE_DIR)) {
      prompts.intro("Upgrade from source")
      prompts.log.info(`Source: ${BUILD_SOURCE_DIR}`)

      // Check if we're in a git repo and if upstream is configured
      let needsSync = false
      try {
        await $`cd ${BUILD_SOURCE_DIR} && git rev-parse --git-dir`.quiet()
        const hasUpstream = await $`cd ${BUILD_SOURCE_DIR} && git remote get-url upstream`
          .quiet()
          .then(() => true)
          .catch(() => false)

        if (hasUpstream) {
          const fetchSpinner = prompts.spinner()
          fetchSpinner.start("Checking for updates...")
          await $`cd ${BUILD_SOURCE_DIR} && git fetch upstream`.quiet()

          const behind = await $`cd ${BUILD_SOURCE_DIR} && git rev-list --count HEAD..upstream/dev`
            .text()
            .then((t) => parseInt(t.trim()))
            .catch(() => 0)
          fetchSpinner.stop("Check complete")

          if (behind > 0) {
            prompts.log.info(`${behind} new commit${behind > 1 ? "s" : ""} available from upstream`)

            if (args.sync) {
              needsSync = true
              const syncSpinner = prompts.spinner()
              syncSpinner.start("Syncing with upstream...")

              try {
                await $`cd ${BUILD_SOURCE_DIR} && git rebase upstream/dev`.quiet()
                syncSpinner.stop("Synced with upstream")

                const pushSpinner = prompts.spinner()
                pushSpinner.start("Pushing to fork...")
                await $`cd ${BUILD_SOURCE_DIR} && git push origin dev --force-with-lease`.quiet()
                pushSpinner.stop("Pushed successfully")
              } catch (err) {
                syncSpinner.stop("Sync failed", 1)
                prompts.log.error("Failed to rebase. Resolve conflicts manually and run upgrade again.")
                prompts.outro("Done")
                return
              }
            }
          } else {
            prompts.log.success("Already up to date with upstream")
          }
        }
      } catch (err) {
        // Not a git repo or upstream not configured, just rebuild
      }

      const spinner = prompts.spinner()
      spinner.start("Building...")

      try {
        await $`cd ${BUILD_SOURCE_DIR}/packages/opencode && ./script/build.ts --single`.quiet()
        spinner.stop("Build complete")

        const installSpinner = prompts.spinner()
        installSpinner.start("Installing...")

        // Determine platform-specific binary name
        const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux"
        const arch = process.arch
        const binaryPath = `${BUILD_SOURCE_DIR}/packages/opencode/dist/opencode-${os}-${arch}/bin/opencode`

        if (!fs.existsSync(binaryPath)) {
          installSpinner.stop("Install failed", 1)
          prompts.log.error(`Binary not found at ${binaryPath}`)
          prompts.outro("Done")
          return
        }

        // Determine install location
        const installDir = process.env.XDG_BIN_HOME || `${process.env.HOME}/.local/bin`

        if (!fs.existsSync(installDir)) {
          fs.mkdirSync(installDir, { recursive: true })
        }

        const installPath = `${installDir}/opencode`

        // Remove old symlink if it exists
        if (fs.existsSync(installPath)) {
          fs.unlinkSync(installPath)
        }

        // Create symlink
        fs.symlinkSync(binaryPath, installPath)

        installSpinner.stop("Installed successfully")
        prompts.log.success(`Binary: ${installPath}`)
        prompts.outro("Done")
        return
      } catch (err) {
        spinner.stop("Build failed", 1)
        if (err instanceof Error) {
          prompts.log.error(err.message)
        }
        prompts.outro("Done")
        return
      }
    }

    // Original upgrade logic for production builds
    prompts.intro("Upgrade")
    const detectedMethod = await Installation.method()
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`opencode is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target ? args.target.replace(/^v/, "") : await Installation.latest()

    if (Installation.VERSION === target) {
      prompts.log.warn(`opencode upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${Installation.VERSION} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await Installation.upgrade(method, target).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) prompts.log.error(err.data.stderr)
      else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}
