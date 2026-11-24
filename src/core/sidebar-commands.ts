import type { Library } from '../library/library';
import { LibraryCommandError } from '../library/space-commands';
import type { TabOrchestrator } from '../orchestrator/tab-orchestrator';
import type { CommandOutcome, SidebarCommand } from './sidebar-protocol';
import type { WindowViews } from './window-views';

/** What a sidebar's commands act on: the Library, the tabs, and the views of the sidebar's window. */
export interface CommandContext {
  library: Library;
  orchestrator: TabOrchestrator;
  views: WindowViews;
  /** The window the sidebar is in. */
  windowId: number;
}

/**
 * Runs a command from a sidebar. The reply waits until the sidebar's window has been sent the
 * view that shows the change, so a sidebar never hears that a command worked before it can
 * show it.
 */
export async function runSidebarCommand(context: CommandContext, command: SidebarCommand): Promise<CommandOutcome> {
  try {
    const spaceId = await run(context, command);
    await context.views.refresh(context.windowId);
    return spaceId === undefined ? { ok: true } : { ok: true, spaceId };
  } catch (error) {
    if (error instanceof LibraryCommandError) {
      return error.spaceName === undefined
        ? { ok: false, reason: error.reason }
        : { ok: false, reason: error.reason, spaceName: error.spaceName };
    }
    console.error(`Could not run the sidebar command ${command.type}:`, error);
    return { ok: false, reason: 'failed' };
  }
}

async function run({ library, orchestrator, windowId }: CommandContext, command: SidebarCommand): Promise<string | undefined> {
  switch (command.type) {
    case 'createSpace':
      return library.createSpace({ icon: command.icon, label: command.label, color: command.color });
    case 'renameSpace':
      return void (await library.renameSpace(command.spaceId, command.label));
    case 'setSpaceIcon':
      return void (await library.setSpaceIcon(command.spaceId, command.icon));
    case 'setSpaceColor':
      return void (await library.setSpaceColor(command.spaceId, command.color));
    case 'moveSpace':
      return void (await library.moveSpace(command.spaceId, command.toIndex));
    case 'switchSpace':
      return void (await orchestrator.switchSpace(windowId, command.spaceId));
    case 'activateTab':
      return void (await orchestrator.activateTab(windowId, command.tabId));
    default:
      throw new Error(`Unknown sidebar command: ${JSON.stringify(command satisfies never)}`);
  }
}
