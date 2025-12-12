# ChromePilot v3 Testing Guide

This document provides manual testing scenarios to verify the v3 iterative system works correctly.

## Prerequisites

1. Ollama running with CORS enabled
2. Models installed: `qwen3-vl-32k:latest` and `llama3.1-8b-32k:latest`
3. ChromePilot extension loaded in Chrome

## Test Scenarios

### Test 1: Basic Iterative Execution

**Objective**: Verify agent executes actions one at a time and continues iterating

**Steps**:
1. Open ChromePilot sidebar
2. Type: "Search YouTube for cats"
3. Observe behavior

**Expected Result**:
- Agent decides first action (e.g., "Open a new tab with URL https://www.youtube.com")
- Action executes automatically
- Agent re-evaluates and decides next action (e.g., "Wait for page to load")
- Process continues iteratively until search is complete
- Each action shows status (⚡ Executing → ✓ Completed)
- Agent declares completion when done

**Key Checks**:
- ✓ No plan approval UI appears
- ✓ Actions execute immediately after decision
- ✓ Agent re-evaluates after each action
- ✓ Execution history is visible
- ✓ Agent detects when goal is achieved

---

### Test 2: Clarification Questions

**Objective**: Verify agent asks for clarification when uncertain

**Steps**:
1. Navigate to a page with multiple buttons (e.g., Google homepage)
2. Type: "Click the button"
3. Observe behavior

**Expected Result**:
- Agent identifies ambiguity (multiple buttons)
- Agent sets `ask_user` with a clarifying question
- Question is displayed with yellow highlight
- Input is re-enabled for user response
- User can provide clarification
- Agent proceeds with clarified action

**Key Checks**:
- ✓ Clarification question appears with ❓ icon
- ✓ Yellow background highlights question
- ✓ Input is enabled for user to respond
- ✓ Agent incorporates user's answer in next decision

---

### Test 3: Error Recovery

**Objective**: Verify agent handles failures and adapts

**Steps**:
1. Type: "Navigate to https://thiswebsitedoesnotexist123456.com"
2. Observe behavior

**Expected Result**:
- Agent attempts navigation
- Navigation fails (404 or DNS error)
- Failure is added to execution history
- Agent re-evaluates with failure context
- Agent either:
  - Asks user for alternative URL, OR
  - Explains the error and suggests alternatives
- Agent does NOT crash or stop responding

**Key Checks**:
- ✓ Failed action shows ✗ Failed status
- ✓ Error message is displayed
- ✓ Agent continues iterating after failure
- ✓ Agent incorporates failure in next decision

---

### Test 4: Conversation Mode

**Objective**: Verify agent can answer questions without taking actions

**Steps**:
1. Navigate to any webpage
2. Type: "What is on this page?"
3. Observe behavior

**Expected Result**:
- Agent sets `needs_action: false`
- Agent provides answer in message
- No action is executed
- Input is re-enabled for follow-up questions

**Key Checks**:
- ✓ No "Next Action" appears
- ✓ Agent provides textual answer
- ✓ Input is enabled for next question
- ✓ No automatic iteration occurs

---

### Test 5: Stop During Iteration

**Objective**: Verify user can stop iteration at any time

**Steps**:
1. Type: "Search YouTube for cats, then open the first video"
2. While agent is executing, click "Stop" button
3. Observe behavior

**Expected Result**:
- Iteration stops immediately
- No further actions are executed
- Current action may complete but next iteration doesn't start
- UI returns to ready state
- User can input new request

**Key Checks**:
- ✓ Stop button is visible during execution
- ✓ Clicking stop halts iteration
- ✓ No errors are thrown
- ✓ UI is re-enabled after stop

---

### Test 6: Complex Multi-Step Task

**Objective**: Verify agent can complete complex tasks iteratively

**Steps**:
1. Type: "Go to Google, search for 'OpenAI', and open the first result"
2. Let agent complete task
3. Observe behavior

**Expected Result**:
- Agent breaks task into individual actions
- Each action is decided based on current state
- Agent adapts if page structure is unexpected
- Agent completes all parts of the request
- Agent confirms completion when done

**Key Checks**:
- ✓ Task is broken into logical actions
- ✓ Each action is re-evaluated fresh
- ✓ Agent handles page navigation correctly
- ✓ Agent waits for page loads
- ✓ Final confirmation is provided

---

## Expected Behavior Summary

### What Should Happen (v3)
- ✅ One action at a time
- ✅ Immediate execution (no approval)
- ✅ Re-evaluation after each action
- ✅ Clarification when uncertain
- ✅ Error recovery and adaptation
- ✅ Dynamic strategy adjustment

### What Should NOT Happen (v2 behavior)
- ❌ Multi-step plan creation
- ❌ Plan approval UI
- ❌ Execute all steps in sequence without re-evaluation
- ❌ Post-execution verification step

---

## Common Issues and Fixes

### Issue: Agent creates multi-step plan instead of single action
**Cause**: Model not following prompt correctly
**Fix**: Check ORCHESTRATOR_PROMPT emphasizes single-action decisions

### Issue: Iteration doesn't continue after action
**Cause**: `continueIteration()` not being called
**Fix**: Verify `executeIterativeAction()` calls `continueIteration()`

### Issue: Actions execute but results aren't used in next decision
**Cause**: Execution history not being passed correctly
**Fix**: Check `continueIteration()` includes execution context in prompt

### Issue: Agent never declares completion
**Cause**: Model doesn't recognize goal achievement
**Fix**: Ensure prompt includes goal context and previous actions

---

## Success Criteria

The v3 iterative system is working correctly if:

1. ✅ Agent decides ONE action at a time (not a full plan)
2. ✅ Actions execute immediately without approval
3. ✅ Agent re-evaluates after EACH action using latest page state
4. ✅ Agent asks clarifying questions when uncertain
5. ✅ Agent handles failures gracefully and adapts
6. ✅ Agent declares completion when goal is achieved
7. ✅ User can stop iteration at any point
8. ✅ Conversation mode works for non-action queries

If all these criteria are met, v3 is fully operational!
