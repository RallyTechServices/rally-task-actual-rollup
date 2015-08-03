Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    calculation_fields: { 'PlanEstimate': 'Plan Estimate', 'TaskActualTotal': 'Actual' ,'TaskEstimateTotal':'Estimate','TaskRemainingTotal':'To Do'},
    items: [
        {xtype:'container', defaults: { margin: 10 },itemId:'selector_box', layout: { type: 'hbox'} },
        {xtype:'container',itemId:'display_box', margin: 10, layout: { type: 'fit' }},
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
                Deft.Chain.pipeline([
                    this._loadPIsWithoutStories,
                    this._loadStories,
                    this._addParentInformation
                ]).then({
                    scope: this,
                    success: function(records) {
                        this.setLoading('Arranging Data...');
                        
                        var top_type = types[types.length - 1].get('Name');
                        
                        var sorters = [];
                        for ( var i=this.pi_types.length; i>0; i-- ) {
                            var type = this.pi_types[i-1].get('ElementName');
                            sorters.push({property: type + "_ObjectID" });
                        }
                        
                        sorters.push({property:'ObjectID'});
                                                
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
                            {dataIndex:'FormattedID',text:'id', csvText:'Story ID', width: 50}, 
                            {dataIndex:'Name',text:'Name', csvText:'Story Name',width: 200},
                            {dataIndex:'Iteration',text:'Iteration',renderer: function(value){
                                var display_value = "Backlog";
                                if ( value ) { 
                                    display_value = value.Name;
                                }
                                return display_value;
                            }, csvText:'Story Iteration',width: 200},
                            {dataIndex: 'PlanEstimate', csvText:'Story Plan Estimate (Pts)', text:'Plan Estimate (Pts)'},
                            {dataIndex: 'TaskEstimateTotal', text:'Estimate Hours', csvText:'Story Estimate Hours'},
                            {dataIndex: 'TaskActualTotal', text:'Actual Hours', csvText:'Story Actual Hours'},
                            {dataIndex: 'TaskRemainingTotal', text:'To Do', csvText:'Story To Do'}
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
            failure: function(message) {
                this._showFailure(message);
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
    _addParentInformation: function(stories) {
        var deferred = Ext.create('Deft.Deferred');
        var app = Rally.getApp();
        var parent_type = 'unset';
        var parent_field = 'unset';
        var parent_oids_by_type = {}; // key is type
        
        var parent_oids = [];
        Ext.Array.each(stories,function(record){ 
            parent_type = app._getParentTypeFor(record.get('_type'));
            console.log(record.get('FormattedID'), record.get('_type'), parent_type );
            if ( parent_type ) {
                var parent_field = parent_type.replace(/.*\//,"");
                if ( ! parent_oids_by_type[parent_type] ) {
                    parent_oids_by_type[parent_type] = [];
                }
                
                var parent = record.get(parent_field) || record.get('Parent');
                
                if ( parent ) {
                    var parent_oid = parent.ObjectID;
                    console.log('has parent:', parent_oid);
                    if ( parent_oid ) {
                        parent_oids_by_type[parent_type] = Ext.Array.merge(parent_oids_by_type[parent_type],[parent_oid]); 
                    }
                }
            }
        });
        
        console.log('--');
        
        var promises = [];
        Ext.Object.each( parent_oids_by_type, function(type,oids) {
            console.log("type/oids:",type,oids);
            if ( oids.length > 0 ) {
                promises.push( app._loadItemsByObjectID(oids,type,[]) );
            }
        });
        
        Deft.Promise.all(promises).then({
            scope: this,
            success: function(parents){
                var item_hash = {};
                console.log("Got promises back", parents);
                
                parents = Ext.Array.flatten(parents);

                Ext.Array.each(parents, function(parent){
                    item_hash[parent.get('ObjectID')] = parent;
                });
                // calculate rollups for direct parents
                Ext.Array.each(stories,function(child) {
                    parent_type = app._getParentTypeFor(child.get('_type'));
                    if ( parent_type ) {
                        parent_field = parent_type.replace(/.*\//,"");
                
                        var parent_link = child.get(parent_field);
                        
                        if ( parent_link ) {
                            
                            var parent = item_hash[parent_link.ObjectID];
                            if ( parent ) {
                                Ext.Object.each(app.calculation_fields,function(calculation_field,calculation_header){
                                    var parent_value = parent.get(calculation_field) || 0;
                                    var child_value = child.get(calculation_field) || 0;
                                    
                                    parent.set(calculation_field,parent_value+child_value);
                                });
                            } else {
                                console.log("NO parent?", parent_link.ObjectID);
                            }
                        }
                    }
                });
                // cycle through parent types to roll up data

                Ext.Array.each(app.pi_types, function(pi_type) {
                    Ext.Object.each(item_hash, function(key,child){
                        if ( Ext.util.Format.lowercase(pi_type.get('TypePath') ) == child.get('_type') ){
                            var parent_link = child.get('Parent');

                            if ( parent_link ) {
                                var parent = item_hash[parent_link.ObjectID];
                                if ( parent ) {
                                    Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                        var parent_value = parent.get(calculation_field) || 0;
                                        var child_value = child.get(calculation_field) || 0;
                                        parent.set(calculation_field,parent_value+child_value);
                                    },this);
                                }
                            }
                        }
                    },app);
                },app);
                var records = app._consolidateParentInfoInStories(stories,item_hash);
                deferred.resolve(records);
            },
            failure: function(error_message) {
                deferred.reject(error_message);
            }
        });
        return deferred.promise;
    },
    _getShortName:function(_type){
        var app = Rally.getApp();
        var short_name = "HierarchicalRequirement";
        Ext.Array.each(app.pi_types,function(pi_type,idx) {
            var lower_type = Ext.util.Format.lowercase(_type);
            var lower_pi_type = Ext.util.Format.lowercase(pi_type.get('TypePath'));
            
            if ( lower_type == lower_pi_type ) {
                short_name = pi_type.get('TypePath').replace(/.*\//,"");
            }
        },this);
        return short_name;
    },
    _getParentTypeFor:function(type) {
        var parent_type = null;
        var lowercase_type = Ext.util.Format.lowercase(type);
        if ( lowercase_type == "hierarchicalrequirement" ) {
            parent_type = this.pi_types[0].get('TypePath');
        } else {
            for ( var idx=0; idx< this.pi_types.length-1; idx++ ) {
                var pi_type = this.pi_types[idx];

                var lowercase_pi_type = Ext.util.Format.lowercase(pi_type.get('TypePath'));

                if ( type == pi_type.get('TypePath') || lowercase_type == lowercase_pi_type) {
                    parent_type = this.pi_types[idx+1].get('TypePath');
                }
            }
        }
        return parent_type;
    },
    _loadItemsByObjectID:function(parent_oids,parent_type,children){
        var deferred = Ext.create('Deft.Deferred');
        
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
            model: parent_type,
            limit: 'Infinity'
        }).load().then({
                scope: this,
                success: function(records) {
                    var grand_parent_oids = [];
                    console.log("got back ", records.length, " items");
                    
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
    /*
     * have to load by type so we can get the parent field
     * (if you do PortfolioItems straight, you don't get a parent)
     */
    _loadStorylessPIsByPIType: function(type_path) {
        var deferred = Ext.create('Deft.Deferred');
        var app = Rally.getApp();

        var fetch = ['Name','ObjectID','FormattedID', 
            'Project','Workspace','Parent'];

        var store = Ext.create('Rally.data.wsapi.Store', {
            fetch: fetch,
            model: type_path,
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
                            var short_type = app._getShortName(record.get('_type'));
                            record.set(short_type + "_FormattedID",record.get('FormattedID'));
                            record.set(short_type + "_ObjectID",record.get('ObjectID'));
                            record.set(short_type + "_Name",record.get('Name'));
                            
                            record.set('Name',"No Story");
                            record.set(short_type,this.getData());
                            record.set('FormattedID', '--');
                            
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
        
        return deferred;
    },
    _loadPIsWithoutStories: function(){
        var deferred = Ext.create('Deft.Deferred');
        var app = Rally.getApp();
        var promises = [];
        
        Ext.Array.each( app.pi_types, function(pi_type){
            promises.push(app._loadStorylessPIsByPIType(pi_type.get('TypePath')));
        });
        
        Deft.Promise.all(promises).then({
            success: function(results) {
                deferred.resolve(Ext.Array.flatten(results));
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },

    _loadStories: function(placeholder_stories){
        var deferred = Ext.create('Deft.Deferred');        
        
        var app = Rally.getApp();
        var pi_field = app.pi_types[0].get('ElementName');
        
        var fetch = ['Name','ObjectID','FormattedID','TaskActualTotal',
            'TaskEstimateTotal','PlanEstimate','TaskRemainingTotal',pi_field, 
            'Project','Workspace','Parent','Iteration'];
        
        var additional_story_fields = app.getSetting('additional_fields') || [];
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

                        var stories = Ext.Array.push(records, placeholder_stories);
                        deferred.resolve(stories);
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
    _consolidateParentInfoInStories: function(rows,parents){
        var lowest_type = this.pi_types[0].get('ElementName');
        
        Ext.Array.each(rows, function(row) {
            this._initializeRowFields(row);
            
            var parent_field = lowest_type;
            if ( row.get('_type') !== 'hierarchicalrequirement') {
                parent_field = 'Parent';
            }

            var row_type = this._getShortName(row.get('_type'));
            var parent_link = row.get(parent_field);
            if ( parent_link ) {
                var parent_oid = parent_link.ObjectID;
                                
                for ( var i=0; i<this.pi_types.length+1; i++ ) {
                   var parent = parents[parent_oid];
                   if ( parent ) {
                       var parent_type = this._getShortName(parent.get('_type'));
                       row.set(parent_type + "_FormattedID", parent.get('FormattedID'));
                       row.set(parent_type + "_ObjectID", parent.get('ObjectID'));
                       row.set(parent_type + "_Name", parent.get('Name'));
                    
                       Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                            var parent_value = parent.get(calculation_field) || 0;
                            row.set(parent_type + "_" + calculation_field,parent_value);
                       });
                       var next_parent = parent.get('Parent');
                       parent_oid = -1;
                       if ( next_parent ) {
                           parent_oid = next_parent.ObjectID;
                       }
                   }
                   
                }
            }

//            if ( parent_link ) {
//                var parent_oid = parent_link.ObjectID;
//                var parent = parents[parent_oid];
//                if ( parent ) {
//                    story.set(lowest_type + "_FormattedID", parent.get('FormattedID'));
//                    story.set(lowest_type + "_ObjectID", parent.get('ObjectID'));
//                    story.set(lowest_type + "_Name", parent.get('Name'));
//                
//                    Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
//                        var parent_value = parent.get(calculation_field) || 0;
//                        story.set(lowest_type + "_" + calculation_field,parent_value);
//                    });
//                }
//                var last_parent = parent;
                
//                for ( var i=1; i<this.pi_types.length; i++ ) {
//                    var type = this.pi_types[i].get('ElementName');
//                    parent_link = last_parent.Parent || last_parent.get('Parent');
//                    if ( parent_link ) {
//                        parent_oid = parent_link.ObjectID;
//                        parent = parents[parent_oid];
//                        if ( parent ) {
//                            story.set(type + "_FormattedID", parent.get('FormattedID'));
//                            story.set(type + "_ObjectID", parent.get('ObjectID'));
//                            story.set(type + "_Name", parent.get('Name'));
//                            
//                            Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
//                                var parent_value = parent.get(calculation_field) || 0;
//                                story.set(type + "_" + calculation_field,parent_value);
//                            });
//                        }
//                    }
//                    last_parent = parent;
//                }
//            }
        },this);
        
        return rows;
    },
    /*
     * Have to set the special fields on everything so that we have something to work with
     * in the custom store (it decides what the fields should be from the first object)
     */
    _initializeRowFields:function(story){
        for ( var i=0; i<this.pi_types.length; i++ ) {
            var type = this.pi_types[i].get('ElementName');
            var field_name = type + "_FormattedID";
            if ( ! story.get(field_name) ) {
                story.set(type + "_FormattedID","");
                story.set(type + "_ObjectID","");
            }
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
        Ext.apply(this.settings, settings);
        this._hideSettings();
        this.onSettingsUpdate(settings);
    },
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        //Build and save column settings...this means that we need to get the display names and multi-list
        this._recalculate();
    },
    isExternal: function(){
      return typeof(this.getAppId()) == 'undefined';
    }
});