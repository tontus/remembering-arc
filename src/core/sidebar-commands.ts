import type { Library } from '../library/library';
import { LibraryCommandError } from '../library/space-commands';
import type { CommandOutcome, SidebarCommand } from './sidebar-protocol';

/**
 * Runs a command from a sidebar. The reply waits for the Library to send its subscribers the
 * changed structure, so a sidebar never hears that a command worked before it can show it.
 */
export async function runSidebarCommand(library: Library, command: SidebarCommand): Promise<CommandOutcome> {
  try {
    const spaceId = await run(library, command);
    await library.read();
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

async function run(library: Library, command: SidebarCommand): Promise<string | undefined> {
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
    default:
      throw new Error(`Unknown sidebar command: ${JSON.stringify(command satisfies never)}`);
  }
}
