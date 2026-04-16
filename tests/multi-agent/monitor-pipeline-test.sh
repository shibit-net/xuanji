#!/bin/bash

# Monitor PipelineTool test execution
echo "🔍 Monitoring PipelineTool Test Execution"
echo "========================================"

OUTPUT_DIR="tests/multi-agent/pipeline-results"
LOG_FILE="tests/multi-agent/pipeline-test-output.log"

# Create output directory if needed
mkdir -p "$OUTPUT_DIR"

# Function to display progress
show_progress() {
    echo ""
    echo "📊 Current Progress:"
    echo "-------------------"
    
    if [ -f "$LOG_FILE" ]; then
        echo "Last 20 lines from log:"
        tail -20 "$LOG_FILE"
    else
        echo "Waiting for log file..."
    fi
    
    echo ""
    echo "📁 Results directory:"
    if [ -d "$OUTPUT_DIR" ]; then
        ls -lh "$OUTPUT_DIR" 2>/dev/null || echo "  (empty)"
    else
        echo "  (not created yet)"
    fi
}

# Monitor loop
echo "⏳ Test running... (press Ctrl+C to stop monitoring)"
echo ""

while true; do
    clear
    echo "🧪 PipelineTool Test Monitor - $(date '+%H:%M:%S')"
    echo "========================================"
    
    show_progress
    
    # Check if test completed
    if [ -f "$OUTPUT_DIR/PIPELINE_TEST_REPORT.md" ]; then
        echo ""
        echo "✅ Test completed! Report generated."
        echo "📄 View report: cat $OUTPUT_DIR/PIPELINE_TEST_REPORT.md"
        break
    fi
    
    sleep 5
done
