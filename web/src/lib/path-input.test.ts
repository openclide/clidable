import { describe, expect, test } from "bun:test";
import { isAbsolutePath, joinPath, pathSeparator, resolveTypedPath } from "./path-input";

const posix = { currentDir: "/Users/me/code", home: "/Users/me" };
const win = { currentDir: "C:\\Users\\me\\code", home: "C:\\Users\\me" };

describe("isAbsolutePath", () => {
  test.each([
    ["/x", true],
    ["C:\\x", true],
    ["c:/x", true],
    ["\\\\server\\share", true], // UNC
    ["\\Users\\me", false], // root-relative: absolute on the CURRENT drive only
    ["C:x", false], // drive-relative
    ["projects/foo", false],
    ["", false],
  ])("%j → %s", (input, expected) => {
    expect(isAbsolutePath(input as string)).toBe(expected);
  });
});

describe("resolveTypedPath", () => {
  test("passes absolute paths through untouched", () => {
    expect(resolveTypedPath("/etc", posix)).toBe("/etc");
    expect(resolveTypedPath("D:\\proj", win)).toBe("D:\\proj");
    expect(resolveTypedPath("\\\\srv\\share", win)).toBe("\\\\srv\\share");
  });

  test("expands ~ against the SERVER's home", () => {
    expect(resolveTypedPath("~", posix)).toBe("/Users/me");
    expect(resolveTypedPath("~/code", posix)).toBe("/Users/me/code");
    expect(resolveTypedPath("~\\code", win)).toBe("C:\\Users\\me\\code");
  });

  test("joins relative input onto the directory on screen", () => {
    expect(resolveTypedPath("foo", posix)).toBe("/Users/me/code/foo");
    expect(resolveTypedPath("foo", win)).toBe("C:\\Users\\me\\code\\foo");
    // Trailing separator on the base must not double up.
    expect(resolveTypedPath("foo", { ...posix, currentDir: "/a/" })).toBe("/a/foo");
    expect(resolveTypedPath("foo", { ...win, currentDir: "C:\\" })).toBe("C:\\foo");
  });

  test("root-relative keeps the current DRIVE, not the current directory", () => {
    // `\Users\me` means "from the root of whatever drive I'm on" — appending it
    // to the current directory would give C:\Users\me\code\Users\me.
    expect(resolveTypedPath("\\Users\\me", win)).toBe("C:\\Users\\me");
  });

  test("drive-relative is passed through for the OS to resolve", () => {
    // `C:foo` means "foo relative to C:'s current directory" — only the OS
    // knows that, so guessing would be wrong.
    expect(resolveTypedPath("C:foo", win)).toBe("C:foo");
  });

  test("REFUSES relative input when there is no base", () => {
    // The picker can be open before its first browse resolves. Passing a bare
    // relative string on would make the SERVER resolve it against its own cwd.
    expect(resolveTypedPath("projects/foo", { currentDir: null, home: "/Users/me" })).toBeNull();
    expect(resolveTypedPath("/absolute", { currentDir: null, home: null })).toBe("/absolute");
  });

  test("strips one surrounding quote pair — Explorer's Copy as path", () => {
    expect(resolveTypedPath('"D:\\proj"', win)).toBe("D:\\proj");
    expect(resolveTypedPath("'/etc'", posix)).toBe("/etc");
  });

  test("does NOT strip quotes that aren't wrapping the whole string", () => {
    // `"a" b "c"` is one string containing two quoted runs; a greedy
    // /^(["'])(.*)\1$/ would mangle it into `a" b "c`.
    expect(resolveTypedPath('"a" b "c"', posix)).toBe('/Users/me/code/"a" b "c"');
    expect(resolveTypedPath('"unclosed', posix)).toBe('/Users/me/code/"unclosed');
  });

  test("empty and whitespace-only input resolve to null", () => {
    for (const s of ["", "   ", '""', "  ''  "]) {
      expect(resolveTypedPath(s, posix)).toBeNull();
    }
  });
});

describe("joinPath / pathSeparator", () => {
  test("uses the separator the directory itself uses", () => {
    expect(pathSeparator("/Users/me")).toBe("/");
    expect(pathSeparator("C:\\Users\\me")).toBe("\\");
    expect(pathSeparator("\\\\srv\\share")).toBe("\\");
    // Unknown/relative shapes fall back to posix rather than guessing Windows.
    expect(pathSeparator("code")).toBe("/");
  });

  test("joins without doubling or mixing separators", () => {
    expect(joinPath("/Users/me", "app")).toBe("/Users/me/app");
    expect(joinPath("/Users/me/", "app")).toBe("/Users/me/app");
    // The bug this exists for: a hardcoded "/" gave C:\Users\me/app.
    expect(joinPath("C:\\Users\\me", "app")).toBe("C:\\Users\\me\\app");
    expect(joinPath("C:\\", "app")).toBe("C:\\app");
    expect(joinPath("\\\\srv\\share", "app")).toBe("\\\\srv\\share\\app");
  });
});
