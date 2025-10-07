#!/bin/bash

echo "YouTube Cookie Extraction Helper"
echo "================================"
echo ""
echo "This script will help you extract YouTube cookies for yt-dlp authentication."
echo ""
echo "Option 1: Browser Extension Method (Recommended)"
echo "-------------------------------------------------"
echo "1. Install a cookie export extension in your browser:"
echo "   - Chrome/Edge: 'Get cookies.txt LOCALLY' or 'cookies.txt'"
echo "   - Firefox: 'cookies.txt'"
echo ""
echo "2. Log in to YouTube in your browser"
echo ""
echo "3. Use the extension to export cookies in Netscape format"
echo ""
echo "4. Save the file as 'cookies.txt' in this directory"
echo ""
echo "Option 2: Using yt-dlp with browser cookies directly"
echo "-----------------------------------------------------"
echo "You can also use yt-dlp's --cookies-from-browser option"
echo "Example: yt-dlp --cookies-from-browser chrome <url>"
echo ""
echo "Option 3: Manual extraction (Advanced)"
echo "--------------------------------------"
echo "Use browser developer tools to extract cookies manually"
echo "Format required: Netscape HTTP Cookie File format"
echo ""
echo "Press Enter to continue..."
read

echo ""
echo "Testing current cookies.txt file..."
if [ -f "cookies.txt" ]; then
    if head -n 1 cookies.txt | grep -q "# Netscape HTTP Cookie File"; then
        echo "✅ cookies.txt appears to be in correct format"
        echo "Lines in file: $(wc -l < cookies.txt)"
    else
        echo "⚠️ cookies.txt is not in Netscape format"
        echo "First line should be: # Netscape HTTP Cookie File"
    fi
else
    echo "❌ cookies.txt not found"
fi