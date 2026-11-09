const assert = require('node:assert/strict');
const { test } = require('node:test');
const { captureNearbyLines, describeWorkingContext } = require('../review-context.cjs');

test('nearby context clips long lines and stops at file boundaries', () => {
    const lines = ['one', 'two', 'x'.repeat(300), 'selected', 'five', 'six', 'seven', 'eight'];
    const context = captureNearbyLines(line => lines[line - 1], lines.length, 4, 4);
    assert.deepEqual(context.before.map(item => item.line), [1, 2, 3]);
    assert.equal(context.before[2].text.length, 250);
    assert.equal(context.before[2].truncated, true);
    assert.deepEqual(context.after.map(item => item.line), [5, 6, 7]);
    assert.deepEqual(captureNearbyLines(line => lines[line - 1], lines.length, 1, 8), { before: [], after: [] });
});

test('a multiline excerpt moves as a whole and repeated excerpts use matching context', () => {
    const comment = {
        firstLine: 2, lastLine: 3, excerpt: 'alpha\r\nbeta',
        context: { before: [{ line: 1, text: 'context' }], after: [] }
    };
    const result = describeWorkingContext(comment, 'alpha\nbeta\ncontext\nalpha\nbeta');
    assert.equal(result.status, 'moved');
    assert.equal(result.firstLine, 4);
    assert.equal(result.lastLine, 5);
    assert.equal(result.excerpt, 'alpha\nbeta');
});

test('a matching copy is unlocated when the original selection and all known neighbours disappear', () => {
    const comment = {
        firstLine: 2, lastLine: 2, excerpt: 'shared text',
        context: {
            before: [{ line: 1, text: 'original header' }],
            after: [{ line: 3, text: 'original footer' }]
        }
    };
    assert.deepEqual(describeWorkingContext(comment, 'other header\nshared text\nother footer'),
        { status: 'unlocated' });
});
