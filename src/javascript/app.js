Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    calculation_fields: { 'PlanEstimate': 'Plan Estimate', 'TaskActualTotal': 'Actual' ,'TaskEstimateTotal':'Estimate','TaskRemainingTotal':'To Do'},
    items: [
        {xtype:'container', defaults: { margin: 10 },itemId:'selector_box', layout: { type: 'hbox'} },
        {xtype:'container',itemId:'display_box', margin: 10},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
         if (this.isExternal()){
            this.showSettings(this.config);
        } else {
            this.onSettingsUpdate(this.getSettings());  
        }
    },
    _recalculate: function() {
        this.setLoading('Loading Stories...');
        this._getPortfolioItemTypes().then({
            scope: this,
            success:function(types) {
                this.pi_types = types;
                var lowest_type = types[0];
                
                this._loadStories(lowest_type.get('ElementName')).then({
                    scope: this,
                    success: function(stories){
                        this.setLoading('Loading Parents...');

                        this._addParentInformation(stories,lowest_type.get('ElementName')).then({
                            scope: this,
                            success: function(parents) {
                                this.setLoading('Arranging Data...');

                                var records = this._consolidateParentInfoInStories(stories,parents);
                                
                                var top_type = types[types.length - 1].get('Name');
                                
                                var sorters = [];
                                for ( var i=this.pi_types.length; i>0; i-- ) {
                                    var type = this.pi_types[i-1].get('ElementName');
                                    sorters.push({property: type + "_ObjectID" });
                                }
                                
                                sorters.push({property:'ObjectID'});
                                
                                this.logger.log("sorters: ",sorters);
                                
                                var store = Ext.create('Rally.data.custom.Store',{
                                    data: records,
                                    sorters: sorters
                                });
                                
                                var shadow_store = Ext.create('Rally.data.custom.Store',{
                                    data: records,
                                    sorters: sorters
                                });
                                
                                var columns = [];
                                columns.push( {dataIndex:'workspace_name', text:'Workspace' } );
                                columns.push( {dataIndex:'program_name', text:'Program' } );
                                columns.push( {dataIndex:'project_name', text:'Project' } );
                                
                                for ( var i=this.pi_types.length; i>0; i-- ) {
                                    var sub_columns = [];
                                    var type = this.pi_types[i-1].get('ElementName');
                                    sub_columns.push({
                                        dataIndex:type + "_FormattedID",
                                        text: " id", width: 50,
                                        csvText: type + " id"
                                    });
                                    sub_columns.push({
                                        dataIndex:type + "_Name",
                                        text: "Name", width: 150,
                                        csvText: type + " Name"
                                    });
                                    Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                        sub_columns.push({
                                            dataIndex:type + "_" +calculation_field,
                                            text: calculation_header,
                                            csvText: type + " " + calculation_header
                                        });
                                    });
                                    columns.push({ text: type, columns: sub_columns });
                                }
                                
                                var story_columns = [
                                    {dataIndex:'FormattedID',text:'id', width: 50}, 
                                    {dataIndex:'Name',text:'Name',width: 200},
                                    {dataIndex:'Iteration',text:'Iteration',renderer: function(value){
                                        var display_value = "Backlog";
                                        if ( value ) { 
                                            display_value = value.Name;
                                        }
                                        return display_value;
                                    },width: 200},
                                    {dataIndex: 'PlanEstimate', text:'Plan Estimate (Pts)'},
                                    {dataIndex: 'TaskEstimateTotal', text:'Estimate Hours'},
                                    {dataIndex: 'TaskActualTotal', text:'Actual Hours'},
                                    {dataIndex: 'TaskRemainingTotal', text:'To Do'}
                                ];
                                
                                var additional_story_fields = this.getSetting('additional_fields') || [];
                                var additional_story_fields = this.getSetting('additional_fields') || [];
                                if( typeof additional_story_fields === 'string' ) {
                                    additional_story_fields = additional_story_fields.split(',');
                                }
                                Ext.Array.each(additional_story_fields,function(additional_field){
                                    story_columns.push({
                                        dataIndex: additional_field,
                                        text: this._getDisplayFromFieldName(additional_field)
                                    });
                                },this);
                                
                                Ext.Array.push(columns, [
                                    { 
                                        text: "Story", 
                                        columns: story_columns
                                    }
                                ]);
                                

                                
                                var grid = this.down('#display_box').add({
                                    xtype: 'rallygrid',
                                    store: store,
                                    sortableColumns: false,
                                    columnCfgs: columns
                                });
                                
                                this._addButton(grid,shadow_store); 
                                this.setLoading(false);
                            },
                            failure: function(error_message) {
                                this._showFailure(error_message);
                            }
                        });
                    },
                    failure: function(error_message){
                        this._showFailure(error_message);
                    }
                });
            },
            failure: function(msg) {
                this._showFailure(msg);
            }
        });
        
        
    },
    _showFailure: function(message) {
        alert(message);
        this.down('#display_box').add({
            xtype:'container', html: message
        });
        this.setLoading(false);
    },
    _getDisplayFromFieldName:function(field_name) {
        var stripped_c = field_name.replace(/^c_/,"");
        var display_array = stripped_c.split(/(?=[A-Z])/);
        
        return display_array.join(' ');
    },
    _addButton: function(grid,store) {
        if ( this._isAbleToDownloadFiles() ) {
            this.down('#selector_box').add({
                xtype:'rallybutton',
                itemId:'save_button',
                text:'Save As CSV',
                scope: this,
                handler: function() {
                    this._getCSVFromGrid(grid,store).then({
                        scope: this,
                        success: function(csv) {
                            this._saveCSVToFile(csv,'task-summary.csv',{type:'text/csv;charset=utf-8'});
                        }
                    });
                }
            });
        }
    },
    _addParentInformation: function(records,parent_field) {
        var deferred = Ext.create('Deft.Deferred');
        
        var parent_oids = [];
        Ext.Array.each(records,function(record){ 
            if ( record.get(parent_field)) {
                var parent_oid = record.get(parent_field).ObjectID;
                if ( parent_oid ) {
                    parent_oids = Ext.Array.merge(parent_oids,[parent_oid]); 
                }
            }
        });
        
        var parent_type = 'PortfolioItem/' + parent_field;
        
        this._loadItemsByObjectID(parent_oids,parent_type,[]).then({
            scope: this,
            success: function(parents){
                var item_hash = {};
                Ext.Array.each(parents, function(parent){
                    item_hash[parent.get('ObjectID')] = parent;
                });
                // calculate rollups for direct parents
                Ext.Array.each(records,function(child) {
                    var parent_link = child.get(parent_field);
                    if ( parent_link ) {
                        var parent = item_hash[parent_link.ObjectID];
                        Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                            var parent_value = parent.get(calculation_field) || 0;
                            var child_value = child.get(calculation_field) || 0;
                            parent.set(calculation_field,parent_value+child_value);
                        });
                    }
                },this);
                // cycle through parent types to roll up data
                this.logger.log("pi types:", this.pi_types);
                Ext.Array.each(this.pi_types, function(pi_type) {
                    this.logger.log('pi type:', pi_type);
                    Ext.Object.each(item_hash, function(key,child){
                        this.logger.log('key,value', key, child);
                        if ( Ext.util.Format.lowercase(pi_type.get('TypePath') ) == child.get('_type') ){
                            var parent_link = child.get('Parent');
                            if ( parent_link ) {
                                var parent = item_hash[parent_link.ObjectID];
                                if ( parent ) {
                                    this.logger.log('calc fields:',this.calculation_fields);
                                    this.logger.log('parent: ', parent);
                                    Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                        var parent_value = parent.get(calculation_field) || 0;
                                        var child_value = child.get(calculation_field) || 0;
                                        parent.set(calculation_field,parent_value+child_value);
                                    },this);
                                }
                            }
                        }
                    },this);
                },this);
                deferred.resolve(item_hash);
            },
            failure: function(error_message) {
                deferred.reject(error_message);
            }
        });
        return deferred.promise;
    },
    _getParentTypeFor:function(type) {
        var parent_type = null;
        Ext.Array.each(this.pi_types,function(pi_type,idx) {
            if ( type == pi_type.get('TypePath') ) {
                parent_type = this.pi_types[idx+1].get('TypePath');
            }
        },this);
        return parent_type;
    },
    _loadItemsByObjectID:function(parent_oids,parent_type,children){
        var deferred = Ext.create('Deft.Deferred');
        this.logger.log("_loadItemsByObjectID",parent_type, parent_oids.length);
        
        var filters = Ext.create('Rally.data.wsapi.Filter',{property:'ObjectID',value:parent_oids[0]});

        for ( var i=1; i<parent_oids.length; i++ ) {
            filters = filters.or(Ext.create('Rally.data.wsapi.Filter',{property:'ObjectID',value:parent_oids[i]}));
        }
        
        var fetch = ['Name','ObjectID','FormattedID','Parent'];
        
        var additional_story_fields = this.getSetting('additional_fields') || [];
        Ext.Array.push(fetch,additional_story_fields);
        
        Ext.create('Rally.data.wsapi.Store', {
            fetch: fetch,
            filters: filters,
            autoLoad: true,
            enablePostGet: true,
            model: parent_type
        }).load().then({
                scope: this,
                success: function(records) {
                    console.log("--", records);
                    var grand_parent_oids = [];
                    Ext.Array.each(records, function(record){
                        if ( record.get('Parent')) {
                            var grand_parent_oid = record.get('Parent').ObjectID;
                            if ( grand_parent_oid ) {
                                grand_parent_oids = Ext.Array.merge(grand_parent_oids,[grand_parent_oid]); 
                            }
                        }
                    });
                    if ( grand_parent_oids.length > 0 ) {
                        this._loadItemsByObjectID(grand_parent_oids,this._getParentTypeFor(parent_type),Ext.Array.merge(records,children)).then({
                            scope: this,
                            success: function(parents) {
                                deferred.resolve(parents);
                            },
                            failure: function(msg) {
                                deferred.reject(msg);
                            }
                        });
                    } else {
                        deferred.resolve(Ext.Array.merge(records,children));
                    }
                },
                failure: function(rejection) {
                    deferred.reject("Failure while loading parents:\r\n" + rejection.error.errors.join('\r\n') + ": " + parent_oids.length);
                }
            });
        return deferred.promise;
    },
    _getPortfolioItemTypes: function() {
        var deferred = Ext.create('Deft.Deferred');
                
        var store = Ext.create('Rally.data.wsapi.Store', {
            fetch: ['Name','ElementName','TypePath'],
            model: 'TypeDefinition',
            filters: [
                {
                    property: 'Parent.Name',
                    operator: '=',
                    value: 'Portfolio Item'
                },
                {
                    property: 'Creatable',
                    operator: '=',
                    value: 'true'
                }
            ],
            autoLoad: true,
            listeners: {
                load: function(store, records, successful) {
                    if (successful){
                        deferred.resolve(records);
                    } else {
                        deferred.reject('Failed to load initial stories');
                    }
                }
            }
        });
                    
        return deferred.promise;
    },
    _loadStories: function(pi_field){
        var deferred = Ext.create('Deft.Deferred');
        
        var fetch = ['Name','ObjectID','FormattedID','TaskActualTotal',
            'TaskEstimateTotal','PlanEstimate','TaskRemainingTotal',pi_field, 
            'Project','Workspace','Parent','Iteration'];
        
        var additional_story_fields = this.getSetting('additional_fields') || [];
        if( typeof additional_story_fields === 'string' ) {
            additional_story_fields = additional_story_fields.split(',');
        }
        Ext.Array.push(fetch,additional_story_fields);
        
        var store = Ext.create('Rally.data.wsapi.Store', {
            fetch: fetch,
            model: 'HierarchicalRequirement',
            filters: [{
                property: 'DirectChildrenCount',
                value: 0
            }],
            limit: 'Infinity',
            autoLoad: true,
            listeners: {
                load: function(store, records, successful) {
                    if (successful){
                        Ext.Array.each(records,function(record){
                            
                            record.set('workspace_name', record.get('Workspace').Name);
                            record.set('project_name', record.get('Project').Name);
                            var program_name = '--';
                            if ( record.get('Project').Parent) {
                                record.set('program_name', record.get('Project').Parent.Name);
                            }
                        });
                        deferred.resolve(records);
                    } else {
                        deferred.reject('Failed to load initial Snapshot Store');
                    }
                }
            }
        });
        return deferred.promise;
    },
    /*
     * want to have a single record per line in the grid for each story, 
     * so tack on the parent-grandparent-etc data on the story record
     */
    _consolidateParentInfoInStories: function(stories,parents){
        this.logger.log("_consolidateParentInfoInStories");
        var lowest_type = this.pi_types[0].get('ElementName');
        
        Ext.Array.each(stories, function(story) {
            this._setStoryFields(story);
            
            var parent_link = story.get(lowest_type);
            if ( parent_link ) {
                var parent_oid = parent_link.ObjectID;
                var parent = parents[parent_oid];
                story.set(lowest_type + "_FormattedID", parent.get('FormattedID'));
                story.set(lowest_type + "_ObjectID", parent.get('ObjectID'));
                story.set(lowest_type + "_Name", parent.get('Name'));
                
                Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                    var parent_value = parent.get(calculation_field) || 0;
                    story.set(lowest_type + "_" + calculation_field,parent_value);
                });
                var last_parent = parent;
                for ( var i=1; i<this.pi_types.length; i++ ) {
                    var type = this.pi_types[i].get('ElementName');
                    parent_link = last_parent.get('Parent');
                    if ( parent_link ) {
                        parent_oid = parent_link.ObjectID;
                        parent = parents[parent_oid];
                        if ( parent ) {
                            story.set(type + "_FormattedID", parent.get('FormattedID'));
                            story.set(type + "_ObjectID", parent.get('ObjectID'));
                            story.set(type + "_Name", parent.get('Name'));
                            
                            Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                var parent_value = parent.get(calculation_field) || 0;
                                story.set(type + "_" + calculation_field,parent_value);
                            });
                        }
                    }
                    last_parent = parent;
                }
            }
        },this);
        
        return stories;
    },
    /*
     * Have to set the special fields on everything so that we have something to work with
     * in the custom store (it decides what the fields should be from the first object)
     */
    _setStoryFields:function(story){
        for ( var i=0; i<this.pi_types.length; i++ ) {
            var type = this.pi_types[i].get('ElementName');
            story.set(type + "_FormattedID","");
            story.set(type + "_ObjectID","");
            Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                story.set(type + "_" + calculation_field,"");
            });
        }
        return story;
    },
    _isAbleToDownloadFiles: function() {
        try { 
            var isFileSaverSupported = !!new Blob(); 
        } catch(e){
            this.logger.log(" NOTE: This browser does not support downloading");
            return false;
        }
        return true;
    },
    _getCSVFromGrid:function(grid, store){
        var deferred = Ext.create('Deft.Deferred');
        
        this.setLoading(true);
        
        var columns = grid.columns;
        var column_names = [];
        var headers = [];
        
        var csv = [];
        
        Ext.Array.each(columns,function(column){
            if ( column.dataIndex ) {
                column_names.push(column.dataIndex);
                if ( column.csvText ) {
                    headers.push(column.csvText);
                } else {
                    headers.push(column.text);
                }
            }
        });
        
        csv.push('"' + headers.join('","') + '"');
        
        store.pageSize = 10000;
        
        store.load({ 
            scope: this,
            callback: function(records) {
                var number_of_records = store.getTotalCount();
                                                
                for ( var i=0; i<number_of_records; i++ ) {
                    var record = store.getAt(i);
                    var node_values = [];
                    Ext.Array.each(columns,function(column){
                        if ( column.dataIndex) {
                            var column_name = column.dataIndex;
                            var display_value = record.get(column_name);
                            if ( column.renderer ) {
                                display_value = column.renderer(display_value);
                            }
                            node_values.push(display_value);
                        }
                    },this);
                    csv.push('"' + node_values.join('","') + '"');
                }  
                this.setLoading(false);
                
                deferred.resolve( csv.join('\r\n') );
            }
        });
        
        return deferred.promise;
        
    },
    _saveCSVToFile:function(csv,file_name,type_object){
        var blob = new Blob([csv],type_object);
        saveAs(blob,file_name);
    },
    /********************************************
    /* Overrides for App class
    /*
    /********************************************/
    _ignoreTextFields: function(field) {
        var should_show_field = true;
        var forbidden_fields = ['FormattedID','ObjectID','DragAndDropRank','Name',
            'PlanEstimate','TaskActualTotal','TaskEstimateTotal','TaskRemainingTotal'];
        if ( field.hidden ) {
            should_show_field = false;
        }
        
        if ( field.attributeDefinition ) {
            
            var type = field.attributeDefinition.AttributeType;
            if ( type == "TEXT" || type == "OBJECT" || type == "COLLECTION" ) {
                should_show_field = false;
            }
            if ( Ext.Array.indexOf(forbidden_fields,field.name) > -1 ) {
                should_show_field = false;
            }
        } else {
            should_show_field = false;
        }
        return should_show_field;
    },
    //getSettingsFields:  Override for App    
    getSettingsFields: function() {
        var me = this;
        
        return [{
            name: 'additional_fields',
            xtype: 'rallyfieldpicker',
            modelTypes: ['HierarchicalRequirement'],
            fieldLabel: 'Additional Columns for User Stories:',
            _shouldShowField: me._ignoreTextFields,
            width: 300,
            labelWidth: 150,
            listeners: {
                ready: function(picker){ picker.collapse(); }
            },
            readyEvent: 'ready' //event fired to signify readiness
        }];
    },
    //showSettings:  Override to add showing when external + scrolling
    showSettings: function(options) {
        this.logger.log("showSettings",options);
        this._appSettings = Ext.create('Rally.app.AppSettings', Ext.apply({
            fields: this.getSettingsFields(),
            settings: this.getSettings(),
            defaultSettings: this.getDefaultSettings(),
            context: this.getContext(),
            settingsScope: this.settingsScope
        }, options));

        this._appSettings.on('cancel', this._hideSettings, this);
        this._appSettings.on('save', this._onSettingsSaved, this);
        
        if (this.isExternal()){
            if (this.down('#display_box').getComponent(this._appSettings.id)==undefined){
                this.down('#display_box').add(this._appSettings);
            }
        } else {
            this.hide();
            this.up().add(this._appSettings);
        }
        return this._appSettings;
    },
    _onSettingsSaved: function(settings){
        this.logger.log('_onSettingsSaved',settings);
        Ext.apply(this.settings, settings);
        this._hideSettings();
        this.onSettingsUpdate(settings);
    },
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        //Build and save column settings...this means that we need to get the display names and multi-list
        this.logger.log('onSettingsUpdate',settings);        
        this._recalculate();
    },
    isExternal: function(){
      return typeof(this.getAppId()) == 'undefined';
    }
});