#!/bin/bash

echo "🍪 YouTube Cookie Exporter"
echo "=========================="
echo ""
echo "This script will help you export YouTube cookies for the bot to use."
echo ""
echo "Option 1: Use yt-dlp to export cookies from your browser"
echo "Option 2: Manually create a cookies file"
echo ""

read -p "Choose option (1 or 2): " option

if [ "$option" = "1" ]; then
    echo ""
    echo "Available browsers:"
    echo "1. Chrome"
    echo "2. Firefox"
    echo "3. Safari"
    echo "4. Edge"
    echo ""
    read -p "Select your browser (1-4): " browser
    
    case $browser in
        1) browser_name="chrome" ;;
        2) browser_name="firefox" ;;
        3) browser_name="safari" ;;
        4) browser_name="edge" ;;
        *) echo "Invalid selection"; exit 1 ;;
    esac
    
    echo ""
    echo "Exporting cookies from $browser_name..."
    yt-dlp --cookies-from-browser $browser_name --cookies cookies.txt --skip-download https://www.youtube.com/
    
    if [ -f "cookies.txt" ]; then
        echo "✅ Cookies exported successfully to cookies.txt"
        echo ""
        echo "The bot will automatically use these cookies for YouTube playback."
    else
        echo "❌ Failed to export cookies. Make sure you're logged into YouTube in $browser_name."
    fi
    
elif [ "$option" = "2" ]; then
    echo ""
    echo "Creating empty cookies.txt file..."
    echo "# Netscape HTTP Cookie File" > cookies.txt
    echo "# This is a generated file! Do not edit." >> cookies.txt
    echo "" >> cookies.txt
    
    echo "✅ Empty cookies.txt created."
    echo ""
    echo "To manually add cookies:"
    echo "1. Install a browser extension like 'Get cookies.txt' or 'cookies.txt'"
    echo "2. Go to youtube.com and log in"
    echo "3. Use the extension to export cookies"
    echo "4. Replace the contents of cookies.txt with the exported data"
    
else
    echo "Invalid option"
    exit 1
fi

echo ""
echo "Done!"